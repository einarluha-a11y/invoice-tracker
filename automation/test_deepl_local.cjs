const admin = require("firebase-admin");
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const serviceAccount = require("./google-credentials.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const imapConfig = {
    imap: {
        user: "invoices@gltechnics.com",
        password: "83Gl92tecH42!", 
        host: "imap.zone.eu",
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function testDeepL() {
    console.log(`Connecting to IMAP...`);
    const connection = await imaps.connect(imapConfig);
    console.log('Connected to zone! Opening INBOX.');
    await connection.openBox('INBOX');

    const searchCriteria = [['UID', 197]]; // The DeepL email UID we found
    const fetchOptions = { bodies: [''], struct: true };

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`Found ${messages.length} email.`);

    if (messages.length > 0) {
        const item = messages[0];
        const all = item.parts.find(a => a.which === '');
        const id = item.attributes.uid;
        
        console.log(`\n--- UID: ${id} ---`);
        const parsedEmail = await simpleParser(all.body);
        console.log(`Attachments: ${parsedEmail.attachments.length}`);
        
        for (const attachment of parsedEmail.attachments) {
            const filename = (attachment.filename || '').toLowerCase();
            const mime = (attachment.contentType || '').toLowerCase();
            console.log(`Found attachment: ${filename} (${mime})`);
            
            // Replicate the exact logic from index.js for this attachment
            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                console.log('[PDF] Parsing PDF data...');
                const pdfParse = require('pdf-parse');
                
                try {
                    const pdfData = await pdfParse(attachment.content);
                    const rawContent = pdfData.text;
                    console.log(`Extracted text length: ${rawContent.length}.`);
                    
                    if (rawContent.trim().length < 10) {
                        console.log(`[PDF] Extracted text is empty. Falling back...`);
                    } else {
                        // Regular parse flow
                        const lowerText = rawContent.toLowerCase();
                        if (lowerText.includes('выписка') || lowerText.includes('revolut business')) {
                             console.log(`Detected bank statement. Skipping...`);
                        } else {
                            console.log(`Would call parseInvoiceDataWithAI(rawContent).`);
                            
                            // Mocking the parse response
                            const mockParsed = [{
                                vendorName: "DeepL SE",
                                amount: 29.99,
                                currency: "EUR",
                                dateCreated: "2026-03-09"
                            }];
                            
                            // Debug the storage upload logic
                            console.log(`Simulating fileUrl attachment...`);
                            let fileUrl = "https://mock-storage-url.com/file.pdf";
                            
                            const saveParsedData = async (data) => {
                                if (data && Array.isArray(data) && data.length > 0) {
                                    data.forEach(inv => {
                                        inv.companyId = "mock-id";
                                        if (fileUrl) inv.fileUrl = fileUrl;
                                    });
                                    console.log("Data to be saved:", data);
                                    return true;
                                }
                                return false;
                            };
                            
                            await saveParsedData(mockParsed);
                        }
                    }
                } catch (e) {
                    console.log("Error parsing PDF:", e.message);
                }
            }
        }
    }
    
    connection.end();
}

testDeepL().catch(console.error).finally(() => process.exit(0));
