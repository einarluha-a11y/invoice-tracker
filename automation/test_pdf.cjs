const fs = require('fs');
const pdfParse = require('pdf-parse');

async function testPdf() {
    // Check if there is a downloaded PDF file in the Downloads folder or we can just read the first bytes of the first attachment
    // Since we don't know the exact filename, let's just create a script that connects to IMAP and pulls the last email's attachment
    const imaps = require('imap-simple');

    const config = {
        imap: {
            user: 'invoices@gltechnics.com',
            password: 'M3vjFKRRJrz2Lhe',
            host: 'imap.zone.eu',
            port: 993,
            tls: true,
            authTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    // get all emails
    const searchCriteria = ['ALL'];
    const fetchOptions = { bodies: [''], struct: true }; // Don't mark as read

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`Checking last email out of ${messages.length}`);

    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const simpleParser = require('mailparser').simpleParser;
        const all = lastMessage.parts.find(a => a.which === '');
        const parsedEmail = await simpleParser(all.body);

        if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
            const file = parsedEmail.attachments[0];
            console.log(`Found attachment: ${file.filename}`);

            if (file.filename.endsWith('.pdf')) {
                const pdfData = await pdfParse(file.content);
                const text = pdfData.text;
                console.log('--- BEGIN PDF TEXT ---');
                console.log(text.substring(0, 500)); // Print first 500 chars
                console.log('--- END PDF TEXT ---');
                console.log('Text includes выписка?', text.toLowerCase().includes('выписка'));
                console.log('Text includes revolut?', text.toLowerCase().includes('revolut'));
            }
        }
    }

    connection.end();
    process.exit(0);
}

testPdf();
