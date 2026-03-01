require('dotenv').config();
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { OpenAI } = require('openai');
const { google } = require('googleapis');

// Initialize OpenAI API
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Sheets Authentication
async function getGoogleAuth() {
    const auth = new google.auth.GoogleAuth({
        keyFile: 'google-credentials.json', // Must be in the same folder
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return auth.getClient();
}

/**
 * 1. AI Parsing: Sends raw text (or CSV string) to OpenAI to extract fields
 */
async function parseInvoiceDataWithAI(rawText) {
    console.log('[AI] Parsing raw data with OpenAI...');

    // System prompt defines the strict output we expect
    const prompt = `
You are an expert accountant system. Extract the following invoice data from the provided raw text (often a messy CSV or email body) and return it EXACTLY in JSON format with NO markdown wrapping, NO extra text.

Required fields (if missing, guess intelligently or leave empty string):
- invoiceId: (e.g. Inv-006, Dok. nr. etc)
- vendorName: (The company issuing the invoice)
- amount: (Number only, decimal separated by dot)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format)
- dueDate: (DD-MM-YYYY format)

Raw Data:
${rawText}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Cost-effective and fast model
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        // Remove markdown formatting if OpenAI accidentally adds it
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();

        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('[AI Error] Failed to parse data:', error);
        return null; // Return null if parsing fails
    }
}

/**
 * 2. Writes the parsed JSON data to the very bottom of the Google Sheet
 */
async function writeToGoogleSheet(data) {
    if (!data) return;

    try {
        console.log('[Sheets] Authenticating with Google...');
        const authClient = await getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
        const range = 'GT Invoices!A:F'; // Writing to columns A to F

        // Prepare the array of values exactly matching the columns
        const values = [
            [
                data.invoiceId || `Auto-${Date.now()}`,
                data.vendorName || 'Unknown Vendor',
                data.amount || '',
                data.currency || 'EUR',
                data.dateCreated || '',
                data.dueDate || ''
                // We leave G (Status) empty for the front-end to calculate automatically
            ]
        ];

        console.log('[Sheets] Appending data: ', values);
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values },
        });

        console.log('[Sheets] Data successfully written to table!');
    } catch (error) {
        console.error('[Sheets Error] Google Sheets upload failed:', error.message);
    }
}

/**
 * 3. Main IMAP function: Connects to email, finds UNSEEN messages with attachments
 */
async function checkEmailForInvoices() {
    const config = {
        imap: {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_HOST,
            port: process.env.IMAP_PORT,
            tls: process.env.IMAP_TLS === 'true',
            authTimeout: 30000, // Increased timeout 
            connTimeout: 30000, // Added connection timeout
            tlsOptions: { rejectUnauthorized: false } // Helps bypass strict SSL cert issues
        }
    };

    try {
        console.log(`[Email] Connecting to IMAP server ${config.imap.host}...`);
        const connection = await imaps.connect(config);

        console.log('[Email] Connection successful! Opening INBOX.');
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN']; // Only get unread emails
        const fetchOptions = { bodies: [''], markSeen: true }; // Mark as read after fetching

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`[Email] Found ${messages.length} unread new emails.`);

        for (const item of messages) {
            const all = item.parts.find(a => a.which === '');
            const id = item.attributes.uid;
            const parsedEmail = await simpleParser(all.body);

            console.log(`[Email] Processing email subject: "${parsedEmail.subject}"`);

            // Find attachments
            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    const filename = attachment.filename.toLowerCase();
                    const mime = attachment.contentType.toLowerCase();

                    if (
                        mime.includes('csv') || mime.includes('excel') ||
                        filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.xls') ||
                        mime.includes('pdf') || filename.endsWith('.pdf')
                    ) {
                        console.log(`[Email] Found relevant attachment: ${attachment.filename}. Reading text...`);

                        let rawContent = '';

                        try {
                            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                                console.log('[PDF] Parsing PDF data...');
                                const pdfParse = require('pdf-parse');
                                const pdfData = await pdfParse(attachment.content);
                                rawContent = pdfData.text;
                            } else {
                                // Default for CSV and readable texts
                                rawContent = attachment.content.toString('utf-8');
                            }

                            // Parse with OpenAI
                            const parsedData = await parseInvoiceDataWithAI(rawContent);

                            // Upload to Google Sheets
                            if (parsedData) {
                                await writeToGoogleSheet(parsedData);
                                console.log(`[Email] Email UID ${id} successfully processed!`);
                            }
                        } catch (err) {
                            console.error(`[Error] Failed to process attachment ${filename}:`, err);
                        }
                    }
                }
            } else {
                console.log(`[Email] No attachments found in email. Skipping.`);
            }
        }

        connection.end();
        console.log('[System] IMAP connection closed. Cycle complete.');
    } catch (error) {
        console.error('[Email Error] IMAP Failure:', error);
    }
}

// Start the process immediately
checkEmailForInvoices();

// Keep script alive to run every 1 minute
console.log('Automated Invoice Processor Started. Checking every 60 seconds...');
setInterval(checkEmailForInvoices, 60000);

// --- CLOUD HOSTING SUPPORT ---
// Render.com and other free hosts require a web server to bind to a PORT.
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('🤖 Invoice Automation Bot is Active & Running!');
    res.end();
}).listen(PORT, () => {
    console.log(`[Web] HTTP server listening on port ${PORT} (Required for cloud hosting).`);
});
