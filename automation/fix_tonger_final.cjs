require('dotenv').config();
const Imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const admin = require('firebase-admin');
const { classifyDocumentWithVision } = require('./vision_auditor.cjs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function uploadInvoice(companyName, fileBuffer, fileName, mimeType) {
    const bucketName = process.env.STORAGE_BUCKET || process.env.VITE_STORAGE_BUCKET || 'invoice-tracker-xyz.firebasestorage.app';
    const bucket = admin.storage().bucket(bucketName);
    const crypto = require('crypto');
    const safeCompany = companyName.replace(/[^a-zA-Z0-9]/g, '_');
    const safeFile = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const destPath = `invoices/${safeCompany}/${Date.now()}_${safeFile}`;
    const file = bucket.file(destPath);
    const uuid = crypto.randomUUID();

    await file.save(fileBuffer, {
        metadata: {
            contentType: mimeType || 'application/pdf',
            metadata: { firebaseStorageDownloadTokens: uuid }
        }
    });
    const encodedPath = encodeURIComponent(destPath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
}

async function writeToFirestore(dataArray) {
    for (const data of dataArray) {
        if (!data.vendorName || !data.amount) continue;
        const mappedData = {
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: data.status || 'OOTEL',
            companyId: 'vlhvA6i8d3Hry8rtrA3Z'
        };
        const res = await db.collection('invoices').add(mappedData);
        console.log(`[Firestore] Wrote pristine record for ${data.vendorName} | ${data.amount} EUR | ID: ${res.id}`);
    }
}

async function recoverTonger() {
    console.log('[Recovery] 🚀 Launching Fresh Node Supervisor explicitly for Tonger Threads...');
    const companyId = 'vlhvA6i8d3Hry8rtrA3Z'; 
    const companyDoc = await db.collection('companies').doc(companyId).get();
    
    const config = {
        imap: {
            user: companyDoc.data().imapUser,
            password: companyDoc.data().imapPassword,
            host: companyDoc.data().imapHost.trim(),
            port: companyDoc.data().imapPort,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000
        }
    };

    let connection;
    try {
        connection = await Imap.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = [['FROM', 'tonger.by']];
        const fetchOptions = { bodies: ['HEADER', ''], struct: true, markSeen: true };
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        console.log(`[Recovery] Found ${messages.length} Tonger emails in the vault.`);

        for (const msg of messages) {
            console.log(`\n[Recovery] Inspecting Email UID: ${msg.attributes.uid}`);
            const allPart = msg.parts.find(p => p.which === '');
            const parsedEmail = await simpleParser(allPart.body);
            
            for (const attachment of parsedEmail.attachments) {
                const mime = attachment.contentType || 'application/pdf';
                console.log(`[Pre-Flight] Analyzing: ${attachment.filename} (${mime})`);
                
                const visionClass = await classifyDocumentWithVision(attachment.content, mime);
                
                if (visionClass !== 'INVOICE') {
                    console.log(`   -> [Vision Auditor] 🚨 REJECTED: Classified strictly as ${visionClass}. Skipping.`);
                    continue;
                }
                
                console.log(`   -> [Vision Auditor] ✅ VERIFIED: True Financial Document. Proceeding...`);
                
                const fileUrl = await uploadInvoice("Ideacom", attachment.content, attachment.filename, mime);
                
                const docAiPayloadList = await processInvoiceWithDocAI(attachment.content, mime);
                if (!docAiPayloadList || docAiPayloadList.length === 0) continue;

                for (let payload of docAiPayloadList) {
                    payload.companyId = companyId;
                    console.log(`[Brain] Feeding extracted payload (${payload.amount} EUR) to Accountant Agent...`);
                    const finalAudit = await auditAndProcessInvoice(payload, fileUrl, companyId);
                    
                    if (finalAudit.status === 'Error' || finalAudit.status === 'Duplicate') {
                        console.log(`   -> [Accountant] 🛑 BLOCKED: ${finalAudit.status} (Reason: ${finalAudit.validationWarnings.join(', ')})`);
                    } else {
                        console.log(`   -> [Accountant] 🟢 APPROVED. Preparing UI injection.`);
                        await writeToFirestore([finalAudit]);
                    }
                }
            }
        }
        console.log(`\n[Recovery] 🏁 Full recovery complete. Tonger threads are natively restored.`);
    } catch(e) {
        console.error('[Recovery] Exception:', e);
    } finally {
        if (connection) connection.end();
        process.exit(0);
    }
}
recoverTonger();
