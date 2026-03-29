const readline = require('readline');
const imaps = require('imap-simple');
const pdfParse = require('pdf-parse');
const { Anthropic } = require('@anthropic-ai/sdk');
require('dotenv').config({ path: __dirname + '/.env' }); 

const { db } = require('./core/firebase.cjs');
const { createWithRetry } = require('./ai_retry.cjs');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const isFix = process.argv.includes('--fix');

const configs = {
    '1': {
        name: 'GLOBAL TECHNICS OÜ',
        companyId: 'bP6dc0PMdFtnmS5QTX4N',
        imap: {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_HOST || 'mail.zone.ee',
            port: parseInt(process.env.IMAP_PORT || '993', 10),
            tls: true,
            authTimeout: 20000
        }
    },
    '2': {
        name: 'IDEACOM OÜ',
        companyId: 'vlhvA6i8d3Hry8rtrA3Z',
        imap: {
            user: process.env.IMAP_USER_2,
            password: process.env.IMAP_PASSWORD_2,
            host: process.env.IMAP_HOST_2 || 'mail.zone.ee',
            port: parseInt(process.env.IMAP_PORT_2 || '993', 10),
            tls: true,
            authTimeout: 20000
        }
    }
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// -----------------------------------------------------
// 1. RECONCILIATION PRIORITY QUEUE LOGIC
// -----------------------------------------------------
async function getVendorAliases(companyId) {
    let defaultAliases = {
        'elron': 'eesti liinirongid as',
        'www.elron.ee': 'eesti liinirongid as',
        'claude': 'anthropic',
        'chatgpt': 'openai',
        'openai': 'openai',
        'youtube': 'google',
        'aws': 'amazon',
        'bolt': 'inredz',
        'wolt': 'wolt'
    };
    try {
        const doc = await db.collection('companies').doc(companyId).get();
        if (doc.exists && doc.data().vendorAliases) {
            return { ...defaultAliases, ...doc.data().vendorAliases };
        }
    } catch (e) {
        // ignore
    }
    return defaultAliases;
}

async function reconcileDryRunOrFix(reference, vendorName, paidAmount, paymentDateStr, companyId, isFix) {
    console.log(`\n🔍 Analyzing Target: €${paidAmount} paid to [${vendorName}] on ${paymentDateStr || 'Unknown date'}`);
    
    paidAmount = Math.abs(parseFloat(paidAmount)) || 0;
    if (paidAmount === 0) {
        console.log(`   🔸 SKIPPED: Amount is 0 or invalid.`);
        return;
    }
    
    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.where('companyId', '==', companyId).get();
    
    const pendingDocs = [];
    const paidDocs = [];
    snapshot.forEach(doc => {
        if (doc.data().status === 'Paid') paidDocs.push(doc);
        else pendingDocs.push(doc);
    });

    const normalizeString = (str) => String(str || '').toLowerCase().trim();
    const normalizeAlphaNum = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const bankRefClean = normalizeAlphaNum(reference);
    let bankDesc = normalizeString(vendorName);

    const vendorAliases = await getVendorAliases(companyId);
    for (const [alias, officialStr] of Object.entries(vendorAliases)) {
        if (bankDesc.includes(alias)) {
            console.log(`   [Alias Match] ${alias} -> ${officialStr}`);
            bankDesc = officialStr;
            break;
        }
    }

    const extractDigits = (str) => String(str || '').replace(/[^0-9]/g, '');
    const refDigits = extractDigits(reference);

    let candidates = [];
    
    const assessCandidate = (doc, isPaid) => {
        const data = doc.data();
        const invoiceAmount = parseFloat(data.amount) || 0;
        
        const isAmountMatch = Math.abs(invoiceAmount - paidAmount) <= 0.05;

        const dbId = normalizeAlphaNum(data.invoiceId);
        const dbDigits = extractDigits(data.invoiceId);
        
        const vendorWords = (data.vendorName || '').toLowerCase().split(/[^a-z0-9]/).filter(w => w.length >= 3);
        const vNameMatch = vendorWords.some(word => bankDesc.includes(word)) || bankDesc.includes((data.vendorName || '').toLowerCase());
        
        let refMatchScore = 0;
        if (dbId) {
            if (dbId === bankRefClean) refMatchScore = 150; 
            else if (dbDigits.length >= 4 && refDigits.length >= 4 && (dbDigits === refDigits)) refMatchScore = 100;
            else if (dbId.length >= 5 && bankRefClean.includes(dbId)) refMatchScore = 50; 
        }

        if (isAmountMatch) {
            if (refMatchScore > 0 || vNameMatch) {
                let totalScore = refMatchScore;
                if (vNameMatch) totalScore += 25;
                if (!isPaid) totalScore += 500;   
                
                candidates.push({ doc, isPaid, totalScore });
            }
        }
    };

    paidDocs.forEach(d => assessCandidate(d, true));
    pendingDocs.forEach(d => assessCandidate(d, false));

    if (candidates.length > 0) {
        candidates.sort((a,b) => b.totalScore - a.totalScore);
        const winner = candidates[0];
        
        if (winner.isPaid) {
            console.log(`   🔸 SKIPPED: Highest priority match is ALREADY PAID -> Invoice ${winner.doc.data().invoiceId} (${winner.doc.data().vendorName})`);
            return;
        } else {
            console.log(`   🟢 MATCH FOUND: Invoice ${winner.doc.data().invoiceId} (${winner.doc.data().vendorName})`);
            if (isFix) {
                await db.runTransaction(async (t) => {
                    const freshDoc = await t.get(winner.doc.ref);
                    if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                    t.update(winner.doc.ref, { status: 'Paid' });
                });
                console.log(`   ✅ (--fix) Document updated to Paid in Firestore.`);
            } else {
                console.log(`   ℹ️  (dry-run) Would update document to Paid in Firestore.`);
            }
        }
    } else {
        console.log(`   ❌ NO MATCH: Could not find any pending invoice for €${paidAmount} from ${vendorName}`);
    }
}

// -----------------------------------------------------
// 2. MAIN CLI RUNNER
// -----------------------------------------------------
async function run() {
    console.log(`\n======================================================`);
    console.log(`🏦 BANK STATEMENT PDF AUTO-RECONCILIATION SCRIPT`);
    console.log(`Mode: ${isFix ? '🔥 --fix ENABLED (Writes to DB)' : '👁️ DRY RUN (No writes)'}`);
    console.log(`======================================================\n`);

    console.log(`Select target company:\n1. GLOBAL TECHNICS OÜ\n2. IDEACOM OÜ`);
    const choice = await askQuestion(`> `);
    const config = configs[choice.trim()];

    if (!config) {
        console.error('Invalid choice. Exiting.');
        process.exit(1);
    }

    console.log(`\n📡 Connecting to ${config.name} IMAP...`);
    let connection;
    try {
        connection = await imaps.connect({ imap: config.imap });
        await connection.openBox('INBOX');
    } catch (e) {
        console.error(`🚨 Fatal IMAP connection error: ${e.message}`);
        console.log(`\n💡 Tip: Your IP might be rate limited by zone.ee. Try running from outside PM2 or wait 5 minutes.`);
        process.exit(1);
    }

    console.log('✅ Connected. Searching for emails from the last 14 days...');
    const d = new Date();
    d.setDate(d.getDate() - 14); // 2 weeks back
    const searchCriteria = ['ALL', ['SINCE', d]];
    const fetchOptions = { bodies: ['HEADER'], struct: true, markSeen: false };

    const messages = await connection.search(searchCriteria, fetchOptions);
    
    if (messages.length === 0) {
        console.log('No recent emails found.');
        process.exit(0);
    }

    const pdfAttachments = [];

    // Extract attachments
    for (const msg of messages) {
        if (!msg.attributes || !msg.attributes.struct) continue;
        
        const parts = imaps.getParts(msg.attributes.struct);
        const attachments = parts.filter(part => part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT');

        for (const attachment of attachments) {
            const ext = attachment.params && attachment.params.name ? attachment.params.name.split('.').pop().toLowerCase() : '';
            if (ext === 'pdf') {
                const headerPart = msg.parts.find(p => p.which === 'HEADER');
                let subject = 'Unknown', date = 'Unknown';
                if (headerPart && headerPart.body) {
                    subject = headerPart.body.subject ? headerPart.body.subject[0] : 'Unknown';
                    date = headerPart.body.date ? headerPart.body.date[0] : 'Unknown';
                }
                pdfAttachments.push({ msg, attachment, subject, date, origName: attachment.params.name });
            }
        }
    }

    if (pdfAttachments.length === 0) {
        console.log('No PDF attachments found in recent emails.');
        process.exit(0);
    }

    console.log('\n📄 Found the following recent PDF attachments:');
    // Display in reverse chronological order (newest first)
    const reversedPdfs = pdfAttachments.reverse();
    reversedPdfs.forEach((pdf, index) => {
        console.log(`[${index + 1}] File: ${pdf.origName} | Subject: "${pdf.subject}" | Date: ${pdf.date}`);
    });

    const pdfIndexStr = await askQuestion(`\nSelect the Bank Statement PDF to parse (1-${reversedPdfs.length}): `);
    const pdfIndex = parseInt(pdfIndexStr, 10) - 1;

    if (isNaN(pdfIndex) || pdfIndex < 0 || pdfIndex >= reversedPdfs.length) {
        console.error('Invalid selection.');
        process.exit(1);
    }

    const targetPdf = reversedPdfs[pdfIndex];
    console.log(`\n📥 Downloading ${targetPdf.origName}...`);

    try {
        const partData = await connection.getPartData(targetPdf.msg, targetPdf.attachment);
        console.log(`✅ Downloaded ${partData.length} bytes.`);
        connection.end();

        console.log(`\n🧠 Parsing PDF text...`);
        const pdfData = await pdfParse(partData);
        let rawText = pdfData.text;
        
        if (!rawText || rawText.trim() === '') {
             console.log(`⚠️  Warning: pdf-parse returned empty text. This might be a scanned image PDF without OCR. Prompting Claude to reject.`);
        } else {
             console.log(`✅ Extracted ${rawText.length} characters of text.`);
        }

        console.log(`🤖 Sending to Claude 3.5 Sonnet to extract ALL transactions (Bypassing Rule 5 limits)...`);

        const prompt = `
You are an expert accountant system. 
You are given the raw text of a Bank Statement PDF for the company "${config.name}".
CRITICAL: Unlike standard invoice parsing, this is a BANK STATEMENT containing MULTIPLE transactions.
You must extract EVERY SINGLE OUTBOUND PAYMENT transaction mathematically present in the text.
Do not stop at the first one. Read the entire document text.

Ignore incoming transfers (positive amounts).
Ignore internal account transfers if they are just moving money between the same company's accounts.
Focus on external supplier outbound payments.

Return EXACTLY a JSON array of objects with NO markdown wrapping, NO extra text.
Each object MUST have:
- "vendorName": The payee company name.
- "amount": The payment amount (positive number).
- "paymentReference": The reference number or payment description.
- "dateCreated": The transaction date in YYYY-MM-DD.

Raw Text:
${rawText.slice(0, 15000)}
`;

        const response = await createWithRetry(anthropic, {
            model: process.env.AI_MODEL || "claude-sonnet-4-6",
            max_tokens: 3000,
            temperature: 0.1,
            system: "You are an expert accountant system.",
            messages: [{ role: "user", content: prompt }]
        });

        const jsonString = response.content[0].text.trim();
        const match = jsonString.match(/\[[\s\S]*\]/);
        const cleanJson = match ? match[0] : '[]';

        let transactions = [];
        try {
            transactions = JSON.parse(cleanJson);
        } catch (e) {
            console.error('Failed to parse Claude JSON response:', cleanJson);
            process.exit(1);
        }

        console.log(`🎉 Claude extracted ${transactions.length} outbound transactions!`);
        console.log(transactions);

        for (const tx of transactions) {
            await reconcileDryRunOrFix(tx.paymentReference, tx.vendorName, tx.amount, tx.dateCreated, config.companyId, isFix);
        }

        console.log(`\n✅ script complete.`);
        process.exit(0);

    } catch (err) {
        console.error(`🚨 Processing failed: ${err.message}`);
        process.exit(1);
    }
}

run();
