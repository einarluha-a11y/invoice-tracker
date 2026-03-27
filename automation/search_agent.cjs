require('dotenv').config();
const admin = require('firebase-admin');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { parseAmount } = require('./accountant_agent.cjs');

// Avoid circular dependency with accountant_agent by just creating the DB insert locally,
// or we can use accountant_agent if careful. Let's just do a clean native insertion!
async function findAndInjectMissingInvoice(vendorName, targetAmount, companyId) {
    const db = admin.firestore();
    const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');
    const compDoc = await db.collection('companies').doc(companyId).get();
    
    // We only search for numbers in the vendor string to be safe with IMAP subjects, 
    // or we just fetch ALL emails since 01-Jan-2026 and text-scan them.
    // Fetching all emails since Jan 1st 2026 is robust and handles all missing vendors safely!
    
    try {
        const connection = await imaps.connect({
            imap: {
                user: compDoc.data().imapUser || process.env.IMAP_USER,
                password: compDoc.data().imapPassword || process.env.IMAP_PASSWORD,
                host: String(compDoc.data().imapHost || process.env.IMAP_HOST).trim(),
                port: compDoc.data().imapPort || 993,
                tls: true,
                authTimeout: 30000,
                connTimeout: 30000,
                tlsOptions: { rejectUnauthorized: false }
            }
        });
        
        await connection.openBox('INBOX');
        console.log(`[Search Agent] 🕵️‍♂️ Accessing Mail Server to hunt down missing invoice for ${vendorName} (${targetAmount} EUR)...`);
        
        // We extend the sweep back to catch legacy Proforma substitutions (Rule 19).
        // Override cutoff year via SEARCH_AGENT_CUTOFF_YEAR env var (e.g. "2026").
        const sinceYear = process.env.SEARCH_AGENT_CUTOFF_YEAR || '2025';
        const rawMessages = await connection.search(['ALL', ['SINCE', `01-Jan-${sinceYear}`]], { bodies: [''] });
        
        for (const item of rawMessages) {
            const all = item.parts.find(a => a.which === '');
            const parsed = await simpleParser(all.body);
            if (!parsed.attachments) continue;
            
            for (const att of parsed.attachments) {
                const fname = (att.filename || '').toLowerCase();
                if (fname.includes('.pdf')) {
                    // Prevent heuristic sweeps on known internal reports/statements to save API calls
                    if (fname.includes('ostuaruanne') || fname.includes('statement') || fname.includes('ledger') || fname.includes('väljavõte')) {
                        continue;
                    }
                    
                    // Local Heuristic Filter (Zero API Cost)
                    let textExtracted = "";
                    try {
                        const pdfData = await pdfParse(att.content);
                        textExtracted = pdfData.text || "";
                    } catch(e) {}
                    
                    // If the text contains the targeted numeric amount OR the vendor name roughly
                    const cleanVendor = vendorName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                    const cleanAmount = String(Math.abs(targetAmount)).replace('.', ',');
                    const cleanAmount2 = String(Math.abs(targetAmount));
                    
                    if (textExtracted.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanVendor) || 
                        textExtracted.includes(cleanAmount) || textExtracted.includes(cleanAmount2)) {
                        
                        console.log(`[Search Agent] 🔎 Plausible physical document located: ${fname}. Engaging deep scan...`);
                        
                        // Retry up to 3 times on rate-limit (429) with exponential backoff
                        let parsedData = null;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                parsedData = await processInvoiceWithDocAI(att.content, 'application/pdf');
                                break; // success
                            } catch (apiErr) {
                                const is429 = apiErr.message && (apiErr.message.includes('429') || apiErr.message.includes('rate_limit'));
                                if (is429 && attempt < 3) {
                                    const waitMs = attempt * 15000; // 15s, 30s
                                    console.warn(`[Search Agent] ⏳ Rate limit hit (attempt ${attempt}/3). Waiting ${waitMs / 1000}s before retry...`);
                                    await new Promise(r => setTimeout(r, waitMs));
                                } else {
                                    console.error(`[Search Agent] ❌ DocAI failed for ${fname} after ${attempt} attempt(s):`, apiErr.message);
                                    break;
                                }
                            }
                        }

                        try {
                            // parsedData is null when DocAI failed entirely — skip attachment
                            if (parsedData) for (let inv of parsedData) {
                                // Prevent Recursive Inception!
                                if (inv.type === 'BANK_STATEMENT') {
                                    console.log(`[Search Agent] ⚠️ Refusing to parse an internal Bank Statement while searching for an Invoice! Skipping document...`);
                                    continue;
                                }
                                
                                // Do the exact mathematical lock-in (shared parseAmount from accountant_agent)
                                const invAmt = Math.abs(parseAmount(inv.amount));
                                const payAmt = Math.abs(parseAmount(targetAmount));
                                
                                if (Math.abs(invAmt - payAmt) < 0.05) {
                                    console.log(`[Search Agent] 🎯 BULLSEYE! Missing Invoice ${inv.invoiceId} recovered structurally!`);
                                    
                                    // Upload to storage
                                    const token = uuidv4();
                                    const destName = `invoices/${companyId}/SEARCH_RECOVERY_${Date.now()}_${att.filename}`;
                                    await bucket.file(destName).save(att.content, { metadata: { contentType: att.contentType, metadata: { firebaseStorageDownloadTokens: token } } });
                                    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destName)}?alt=media&token=${token}`;
                                    
                                    // Import accountant_agent dynamically
                                    const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
                                    inv.companyId = companyId;
                                    const finalData = await auditAndProcessInvoice(inv, fileUrl, companyId);
                                    
                                    // Inject into database — use finalData.companyId in case
                                    // auditAndProcessInvoice re-routed to a different company.
                                    const docRef = await db.collection('invoices').add({
                                        companyId: finalData.companyId || companyId,
                                        invoiceId: String(finalData.invoiceId || 'N/A'),
                                        vendorName: String(finalData.vendorName || 'Unknown'),
                                        ...finalData
                                    });
                                    
                                    console.log(`[Search Agent] 💾 New database record secured at ${docRef.id}`);
                                    connection.end();
                                    return docRef; // Gracefully return the reference for Accountant Agent to mark Paid!
                                }
                            }
                        } catch(innerErr) {
                            console.error(`[Search Agent] ❌ Error processing recovered invoice from ${fname}:`, innerErr.message);
                        }
                    }
                }
            }
        }
        
        connection.end();
        return null; // Return null if exhaustive search yields nothing
        
    } catch(connectionError) {
        console.error("[Search Agent] 🚨 Mail Server disconnect:", connectionError.message);
        return null;
    }
}

module.exports = { findAndInjectMissingInvoice };
