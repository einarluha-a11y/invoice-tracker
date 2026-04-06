const readline = require('readline');
const imaps = require('imap-simple');
const pdfParse = require('pdf-parse');
require('dotenv').config({ path: __dirname + '/.env' });

const { db } = require('./core/firebase.cjs');
const { cleanNum, getVendorAliases: _getVendorAliases } = require('./core/utils.cjs');

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
            tlsOptions: { rejectUnauthorized: false },
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
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 20000
        }
    }
};


async function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// -----------------------------------------------------
// 1. RECONCILIATION PRIORITY QUEUE LOGIC
// -----------------------------------------------------
const getVendorAliases = (companyId) => _getVendorAliases(db, companyId);

async function reconcileDryRunOrFix(reference, vendorName, paidAmount, paymentDateStr, companyId, isFix) {
    console.log(`\n🔍 Analyzing Target: €${paidAmount} paid to [${vendorName}] on ${paymentDateStr || 'Unknown date'}`);
    
    paidAmount = Math.abs(cleanNum(paidAmount));
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
        const invoiceAmount = cleanNum(data.amount);
        
        // Use 0.50 tolerance to safely absorb Revolut's €0.20/€0.25 transfer fees mapped to total transit.
        const isAmountMatch = Math.abs(invoiceAmount - paidAmount) <= 0.50;

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

    let choice = process.argv.find(arg => arg.startsWith('--company='))?.split('=')[1];
    if (!choice) {
        console.log(`Select target company:\n1. GLOBAL TECHNICS OÜ\n2. IDEACOM OÜ`);
        choice = await askQuestion(`> `);
    }
    const config = configs[choice.trim()];

    if (!config) {
        console.error('Invalid choice. Exiting.');
        process.exit(1);
    }

    let targetPdfData = null;
    let originalName = 'local_file.pdf';

    const fileArg = process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1];
    
    if (fileArg) {
        const fs = require('fs');
        if (fs.existsSync(fileArg)) {
            console.log(`\n📥 Reading local file ${fileArg}...`);
            targetPdfData = fs.readFileSync(fileArg);
            originalName = fileArg.split('/').pop();
        } else {
            console.error(`🚨 File not found: ${fileArg}`);
            process.exit(1);
        }
    } else {
        console.log(`\n📡 Connecting to ${config.name} IMAP...`);
        let connection;
        try {
            connection = await imaps.connect({ imap: config.imap });
            await connection.openBox('INBOX');
        } catch (e) {
            console.error(`🚨 Fatal IMAP connection error: ${e.message}`);
            console.log(`\n💡 Tip: Your IP might be rate limited by zone.ee. Try running from outside PM2 or wait 5 minutes, or use --file=/path/to/pdf`);
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
        const reversedPdfs = pdfAttachments.reverse();
        reversedPdfs.forEach((pdf, index) => {
            console.log(`[${index + 1}] File: ${pdf.origName} | Subject: "${pdf.subject}" | Date: ${pdf.date}`);
        });

        let pdfIndexStr = process.argv.find(arg => arg.startsWith('--pdf='))?.split('=')[1];
        if (!pdfIndexStr) {
            pdfIndexStr = await askQuestion(`\nSelect the Bank Statement PDF to parse (1-${reversedPdfs.length}): `);
        }
        const pdfIndex = parseInt(pdfIndexStr, 10) - 1;

        if (isNaN(pdfIndex) || pdfIndex < 0 || pdfIndex >= reversedPdfs.length) {
            console.error('Invalid selection.');
            process.exit(1);
        }

        const targetPdf = reversedPdfs[pdfIndex];
        console.log(`\n📥 Downloading ${targetPdf.origName}...`);
        targetPdfData = await connection.getPartData(targetPdf.msg, targetPdf.attachment);
        originalName = targetPdf.origName;
        console.log(`✅ Downloaded ${targetPdfData.length} bytes.`);
        connection.end();
    }

    try {
        console.log(`\n🧠 Parsing PDF text...`);
        const pdfData = await pdfParse(targetPdfData);
        let rawText = pdfData.text;
        
        if (!rawText || rawText.trim() === '') {
             console.log(`⚠️  Warning: pdf-parse returned empty text. This might be a scanned image PDF without OCR. Prompting Claude to reject.`);
        } else {
             console.log(`✅ Extracted ${rawText.length} characters of text.`);
        }

        // TODO: Re-implement transaction extraction with a new AI provider.
        // Previously used Anthropic Claude API to extract transactions from bank statement text.
        console.error(`🚨 Transaction extraction disabled (Anthropic removed). Cannot parse bank statement automatically.`);
        console.log(`ℹ️  Raw text length: ${rawText.length} characters. Manual processing required.`);

        let transactions = [];
        console.log(`Extracted ${transactions.length} transactions (AI disabled).`);
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
