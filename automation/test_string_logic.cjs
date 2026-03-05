const fs = require('fs');
const pdfParse = require('pdf-parse');
const imaps = require('imap-simple');

async function checkLogic() {
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

  const messages = await connection.search(['ALL'], { bodies: [''], struct: true });
  
  const lastMessage = messages[messages.length - 1];
  const simpleParser = require('mailparser').simpleParser;
  const all = lastMessage.parts.find(a => a.which === '');
  const parsedEmail = await simpleParser(all.body);
  
  if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
      const file = parsedEmail.attachments[0];
      if (file.filename.endsWith('.pdf')) {
          const pdfData = await pdfParse(file.content);
          const rawText = pdfData.text;
          const lowerText = rawText.toLowerCase();

          // Print boolean logic map
          console.log(`Includes 'выписка':`, lowerText.includes('выписка'));
          console.log(`Includes 'revolut business':`, lowerText.includes('revolut business'));
          console.log(`Includes 'revolut bank':`, lowerText.includes('revolut bank'));
          console.log(`Includes 'account statement':`, lowerText.includes('account statement'));

          // The actual exact if statement running in index.js currently:
          const isBankStatement = lowerText.includes('выписка') || 
                                  lowerText.includes('revolut business') || 
                                  lowerText.includes('revolut bank') || 
                                  lowerText.includes('account statement');
                                  
          console.log(`\nIS BANK STATEMENT TRIGGERED: ${isBankStatement}`);
      }
  }
  
  connection.end();
  process.exit(0);
}

checkLogic();
