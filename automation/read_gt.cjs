const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { parseInvoiceDataWithAI, writeToFirestore, parseInvoiceImageWithAI } = require('./index_local.js');
const pdfParse = require('pdf-parse');

const GT_CONFIG = {
    name: 'Global Technics OÜ',
    companyId: 'bP6dc0PMdFtnmS5QTX4N', // Actually it looks like GT is bP6dc0PMdFtnmS5QTX4N based on previous logs and list_companies!
    // Wait, list_companies showed: Company ID: bP6dc0PMdFtnmS5QTX4N | Name: Global Technics OÜ. So bP... is GT and vl... is Ideacom.
    config: {
        user: 'invoices@gltechnics.com',
        password: '83Gl92tecH42!',
        host: 'imap.zone.eu',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

const localApp = require('./index_local.js');

async function checkGT() {
    console.log(`\n\n--- Checking Global Technics ---`);
    try {
        const connection = await imaps.connect({ imap: GT_CONFIG.config });
        await connection.openBox('INBOX');

        // Search for UNSEEN OR anything from the past 24 hours just in case
        const today = new Date();
        const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        
        const searchCriteria = [['SINCE', yesterday]];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true };
        
        console.log("Searching for RECENT messages...");
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`\n📬 Found ${messages.length} recent messages.`);
        
        for (const item of messages.slice(-5)) { 
            const header = item.parts.find(a => a.which === 'HEADER');
            console.log(`- UID: ${item.attributes.uid} | Subject: "${header.body.subject[0]}" | Date: ${header.body.date[0]}`);
            
            // Check if it's the Re-Est invoice
            if (header.body.subject[0].includes('Re-Est') || header.body.subject[0].includes('10032026') || header.body.subject[0].includes('194')) {
                console.log("THIS LOOKS LIKE THE MISSING INVOICE! processing...");
                
                const all = item.parts.find(a => a.which === '');
                const parsedEmail = await simpleParser(all.body);

                if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                    for (const attachment of parsedEmail.attachments) {
                        if (attachment.contentType.includes('pdf') || attachment.filename.endsWith('.pdf')) {
                            console.log(`Extracting text from PDF attachment: ${attachment.filename}...`);
                            const pdfData = await pdfParse(attachment.content);
                            const rawContent = pdfData.text;
                            
                            console.log('Sending to AI...');
                            const parsedData = await localApp.parseInvoiceDataWithAI(rawContent, GT_CONFIG.name, "");
                            console.log('AI Result:', JSON.stringify(parsedData, null, 2));

                            if (parsedData && parsedData.length > 0) {
                                parsedData.forEach(i => i.companyId = "bP6dc0PMdFtnmS5QTX4N");
                                parsedData.forEach(i => i.fileUrl = null); // Temporary bypass file upload

                                console.log('Writing to Firestore (and triggering Zapier)...');
                                await localApp.writeToFirestore(parsedData);
                                console.log('Done!');
                                
                                // Upload file script will be run separately just like we did for Ideacom to ensure we don't hit index.js errors
                            }
                        }
                    }
                }
            }
        }

        connection.end();
    } catch (e) {
        console.error(e);
    }
    setTimeout(() => process.exit(0), 5000); 
}

checkGT();
