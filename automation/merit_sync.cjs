#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MERIT AKTIVA API — Invoice & Payment Sync            ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Sends purchase invoices and payments to Merit Aktiva.       ║
 * ║  Auth: HMAC-SHA256 signature per request.                    ║
 * ║  All communication HTTPS only.                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node merit_sync.cjs --test --id <invoiceId>    Test single invoice
 *   node merit_sync.cjs --sync-all                  Sync all pending
 *   node merit_sync.cjs --sync-payments             Sync all unsent payments
 *
 * Required env vars: MERIT_API_ID, MERIT_API_KEY, MERIT_API_URL
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const https = require('https');
const { admin, db } = require('./core/firebase.cjs');

// ── Config ───────────────────────────────────────────────────────────────────
const MERIT_API_ID  = process.env.MERIT_API_ID || '';
const MERIT_API_KEY = process.env.MERIT_API_KEY || '';
const MERIT_API_URL = process.env.MERIT_API_URL || 'https://aktiva.merit.ee/api/v1';

if (!MERIT_API_URL.startsWith('https://')) {
    throw new Error('[Merit] FATAL: MERIT_API_URL must use HTTPS. Got: ' + MERIT_API_URL);
}

// ── Tax cache ────────────────────────────────────────────────────────────────
let _taxCache = null;
let _taxCacheAt = 0;
const TAX_CACHE_TTL = 3600000; // 1 hour

// ── Auth ─────────────────────────────────────────────────────────────────────
function meritTimestamp() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const h = String(now.getUTCHours()).padStart(2, '0');
    const min = String(now.getUTCMinutes()).padStart(2, '0');
    const s = String(now.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${d}${h}${min}${s}`;
}

function meritSignature(timestamp, body) {
    const dataToSign = MERIT_API_ID + timestamp + body;
    const hmac = crypto.createHmac('sha256', Buffer.from(MERIT_API_KEY, 'ascii'));
    hmac.update(dataToSign, 'utf-8');
    return hmac.digest('base64');
}

// ── HTTP Request ─────────────────────────────────────────────────────────────
function meritRequest(endpoint, body, method = 'POST') {
    return new Promise((resolve, reject) => {
        const jsonBody = method === 'POST' ? JSON.stringify(body) : '';
        const timestamp = meritTimestamp();
        const signature = meritSignature(timestamp, jsonBody);

        const encodedSig = encodeURIComponent(signature);
        const url = `${MERIT_API_URL}/${endpoint}?ApiId=${MERIT_API_ID}&timestamp=${timestamp}&signature=${encodedSig}`;

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch { resolve(data); }
                } else if (res.statusCode === 429) {
                    reject(new Error(`RATE_LIMITED: ${res.statusCode} ${data}`));
                } else {
                    reject(new Error(`MERIT_ERROR ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (jsonBody) req.write(jsonBody);
        req.end();
    });
}

// ── Retry wrapper ────────────────────────────────────────────────────────────
async function meritRequestWithRetry(endpoint, body, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await meritRequest(endpoint, body);
        } catch (err) {
            const isRetryable = err.message.includes('RATE_LIMITED') || /MERIT_ERROR 5\d\d/.test(err.message);
            if (isRetryable && attempt < maxRetries) {
                console.warn(`[Merit] Retry ${attempt}/${maxRetries} for ${endpoint}: ${err.message}`);
                await new Promise(r => setTimeout(r, 30000 * attempt));
            } else {
                throw err;
            }
        }
    }
}

// ── Get Tax IDs ──────────────────────────────────────────────────────────────
async function getTaxes() {
    if (_taxCache && Date.now() - _taxCacheAt < TAX_CACHE_TTL) return _taxCache;
    const result = await meritRequest('gettaxes', null, 'GET');
    _taxCache = result;
    _taxCacheAt = Date.now();
    console.log(`[Merit] Loaded ${result.length} tax codes`);
    return result;
}

function findTaxId(taxes, percent) {
    // Find matching tax rate, prefer exact match
    const match = taxes.find(t => Math.abs(Number(t.Percent) - percent) < 0.01);
    return match ? match.Id : null;
}

// ── Date format ──────────────────────────────────────────────────────────────
function toMeritDate(dateStr) {
    if (!dateStr) return meritTimestamp();
    // Input: YYYY-MM-DD or DD.MM.YYYY
    let d;
    if (dateStr.includes('-')) {
        d = new Date(dateStr + 'T00:00:00Z');
    } else if (dateStr.includes('.')) {
        const [day, month, year] = dateStr.split('.');
        d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    } else {
        d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return meritTimestamp();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${dd}000000`;
}

// ── Validate before sending ──────────────────────────────────────────────────
function validateInvoice(inv) {
    const errors = [];
    if (!inv.vendorName) errors.push('Missing vendorName');
    if (!inv.invoiceId) errors.push('Missing invoiceId');
    if (!inv.amount || inv.amount <= 0) errors.push('Invalid amount: ' + inv.amount);
    if (!inv.dateCreated) errors.push('Missing dateCreated');
    if (inv.invoiceId && inv.invoiceId.length > 35) errors.push('invoiceId > 35 chars');
    return errors;
}

// ── Sync Invoice ─────────────────────────────────────────────────────────────
async function syncInvoiceToMerit(invoiceData, invoiceDocId) {
    if (!MERIT_API_ID || !MERIT_API_KEY) {
        console.warn('[Merit] API credentials not configured — skipping sync');
        return null;
    }

    // Idempotency check
    if (invoiceData.meritSyncedAt) {
        console.log(`[Merit] Already synced: ${invoiceData.invoiceId} (${invoiceData.meritSyncedAt})`);
        return null;
    }

    // Validate
    const errors = validateInvoice(invoiceData);
    if (errors.length > 0) {
        console.warn(`[Merit] Validation failed for ${invoiceData.invoiceId}: ${errors.join(', ')}`);
        if (db && invoiceDocId) {
            await db.collection('invoices').doc(invoiceDocId).update({
                meritSyncError: errors.join(', '),
            });
        }
        return null;
    }

    // Get tax codes
    const taxes = await getTaxes();
    const taxPercent = (invoiceData.subtotalAmount > 0 && invoiceData.taxAmount > 0)
        ? Math.round((invoiceData.taxAmount / invoiceData.subtotalAmount) * 100)
        : 0;
    const taxId = findTaxId(taxes, taxPercent);
    const zeroTaxId = findTaxId(taxes, 0);

    if (!taxId && taxPercent > 0) {
        console.warn(`[Merit] Tax rate ${taxPercent}% not found in Merit tax codes`);
    }

    // Country code from VAT
    const countryCode = (invoiceData.supplierVat || '').slice(0, 2) || 'EE';

    // Build line items
    const invoiceRows = (invoiceData.lineItems || []).map((li, idx) => ({
        Item: {
            Code: String(idx + 1).padStart(3, '0'),
            Description: (li.description || 'Item').slice(0, 100),
            Type: 3, // item
        },
        Quantity: li.quantity || 1,
        Price: li.unitPrice || li.amount || 0,
        TaxId: (li.tax && li.tax > 0) ? taxId : (zeroTaxId || taxId),
    }));

    // Fallback: if no line items, create one from totals
    if (invoiceRows.length === 0) {
        invoiceRows.push({
            Item: {
                Code: '001',
                Description: (invoiceData.description || 'Service').slice(0, 100),
                Type: 2, // service
            },
            Quantity: 1,
            Price: invoiceData.subtotalAmount || invoiceData.amount || 0,
            TaxId: taxId || zeroTaxId,
        });
    }

    // Build Merit payload
    const payload = {
        Vendor: {
            Name: (invoiceData.vendorName || '').slice(0, 150),
            RegNo: invoiceData.supplierRegistration || '',
            VatRegNo: invoiceData.supplierVat || '',
            VatAccountable: !!(invoiceData.supplierVat),
            CountryCode: countryCode,
            CurrencyCode: invoiceData.currency || 'EUR',
        },
        DocDate: toMeritDate(invoiceData.dateCreated),
        DueDate: toMeritDate(invoiceData.dueDate),
        TransactionDate: toMeritDate(invoiceData.dateCreated),
        BillNo: (invoiceData.invoiceId || '').slice(0, 35),
        CurrencyCode: invoiceData.currency || 'EUR',
        InvoiceRow: invoiceRows,
        TaxAmount: [{
            TaxId: taxId || zeroTaxId,
            Amount: invoiceData.taxAmount || 0,
        }],
        TotalAmount: invoiceData.subtotalAmount || invoiceData.amount || 0,
        Hcomment: (invoiceData.description || '').slice(0, 4000),
        ExpenseClaim: false,
    };

    try {
        console.log(`[Merit] Sending invoice ${invoiceData.invoiceId} (${invoiceData.vendorName}, ${invoiceData.amount} ${invoiceData.currency})...`);
        const result = await meritRequestWithRetry('sendpurchinvoice', payload);
        console.log(`[Merit] ✅ Invoice synced: ${invoiceData.invoiceId} → Merit ID: ${result?.InvoiceId || result}`);

        // Update Firestore
        if (db && invoiceDocId) {
            await db.collection('invoices').doc(invoiceDocId).update({
                meritSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
                meritInvoiceId: result?.InvoiceId || null,
                meritSyncError: null,
            });
        }

        // Audit log
        if (db) {
            await db.collection('merit_sync_log').add({
                type: 'invoice',
                invoiceDocId,
                invoiceId: invoiceData.invoiceId,
                vendorName: invoiceData.vendorName,
                amount: invoiceData.amount,
                currency: invoiceData.currency,
                meritInvoiceId: result?.InvoiceId || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'success',
            });
        }

        return result;
    } catch (err) {
        console.error(`[Merit] ❌ Failed to sync ${invoiceData.invoiceId}: ${err.message}`);
        if (db && invoiceDocId) {
            await db.collection('invoices').doc(invoiceDocId).update({
                meritSyncError: err.message.slice(0, 500),
            });
        }
        if (db) {
            await db.collection('merit_sync_log').add({
                type: 'invoice',
                invoiceDocId,
                invoiceId: invoiceData.invoiceId,
                vendorName: invoiceData.vendorName,
                error: err.message.slice(0, 500),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'error',
            });
        }
        return null;
    }
}

// ── Sync Payment ─────────────────────────────────────────────────────────────
async function syncPaymentToMerit(invoiceData, payment, invoiceDocId) {
    if (!MERIT_API_ID || !MERIT_API_KEY) return null;
    if (invoiceData.meritPaymentSyncedAt) return null;

    // Get company IBAN
    let iban = '';
    if (db && invoiceData.companyId) {
        try {
            const compDoc = await db.collection('companies').doc(invoiceData.companyId).get();
            iban = compDoc.data()?.iban || compDoc.data()?.bankAccount || '';
        } catch { /* use empty */ }
    }

    const payload = {
        IBAN: iban,
        CustomerName: (invoiceData.vendorName || '').slice(0, 150),
        InvoiceNo: (invoiceData.invoiceId || '').slice(0, 35),
        RefNo: payment?.reference || '',
        Amount: payment?.amount || invoiceData.amount || 0,
    };

    try {
        console.log(`[Merit] Sending payment for ${invoiceData.invoiceId} (${payload.Amount} EUR)...`);
        const result = await meritRequestWithRetry('sendpayment', payload);
        console.log(`[Merit] ✅ Payment synced: ${invoiceData.invoiceId}`);

        if (db && invoiceDocId) {
            await db.collection('invoices').doc(invoiceDocId).update({
                meritPaymentSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        if (db) {
            await db.collection('merit_sync_log').add({
                type: 'payment',
                invoiceDocId,
                invoiceId: invoiceData.invoiceId,
                amount: payload.Amount,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'success',
            });
        }
        return result;
    } catch (err) {
        console.error(`[Merit] ❌ Payment failed for ${invoiceData.invoiceId}: ${err.message}`);
        if (db) {
            await db.collection('merit_sync_log').add({
                type: 'payment',
                invoiceDocId,
                invoiceId: invoiceData.invoiceId,
                error: err.message.slice(0, 500),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'error',
            });
        }
        return null;
    }
}

// ── Sync All Pending ─────────────────────────────────────────────────────────
async function syncAllPending() {
    if (!db) { console.error('[Merit] DB not available'); return; }
    if (!MERIT_API_ID || !MERIT_API_KEY) {
        console.warn('[Merit] API credentials not configured — nothing to sync');
        return;
    }

    const snap = await db.collection('invoices').get();
    let synced = 0, failed = 0, skipped = 0;

    for (const doc of snap.docs) {
        const d = doc.data();
        if (d.meritSyncedAt) { skipped++; continue; }
        if (d.status === 'Duplicate' || d.status === 'UNREPAIRABLE') { skipped++; continue; }

        const result = await syncInvoiceToMerit(d, doc.id);
        if (result) synced++;
        else failed++;

        // Rate limit protection
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Merit] Sync complete: ${synced} synced, ${failed} failed, ${skipped} skipped`);
}

// ── Sync All Unsent Payments ─────────────────────────────────────────────────
async function syncAllPayments() {
    if (!db) return;
    if (!MERIT_API_ID || !MERIT_API_KEY) return;

    const snap = await db.collection('invoices')
        .where('status', '==', 'Paid')
        .get();
    let synced = 0, skipped = 0;

    for (const doc of snap.docs) {
        const d = doc.data();
        if (d.meritPaymentSyncedAt) { skipped++; continue; }
        if (!d.meritSyncedAt) { skipped++; continue; } // invoice must be synced first

        const payment = (d.payments || [])[0] || { amount: d.amount };
        await syncPaymentToMerit(d, payment, doc.id);
        synced++;
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Merit] Payments sync: ${synced} sent, ${skipped} skipped`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--test')) {
        const idIdx = args.indexOf('--id');
        const invoiceDocId = idIdx !== -1 ? args[idIdx + 1] : null;
        if (!invoiceDocId) {
            console.error('Usage: node merit_sync.cjs --test --id <invoiceDocId>');
            process.exit(1);
        }
        (async () => {
            const doc = await db.collection('invoices').doc(invoiceDocId).get();
            if (!doc.exists) { console.error('Invoice not found:', invoiceDocId); process.exit(1); }
            const result = await syncInvoiceToMerit(doc.data(), invoiceDocId);
            console.log('Result:', JSON.stringify(result, null, 2));
            process.exit(result ? 0 : 1);
        })();
    } else if (args.includes('--sync-all')) {
        syncAllPending().then(() => process.exit(0));
    } else if (args.includes('--sync-payments')) {
        syncAllPayments().then(() => process.exit(0));
    } else {
        console.log('Usage:');
        console.log('  node merit_sync.cjs --test --id <invoiceDocId>');
        console.log('  node merit_sync.cjs --sync-all');
        console.log('  node merit_sync.cjs --sync-payments');
    }
}

module.exports = { syncInvoiceToMerit, syncPaymentToMerit, syncAllPending, syncAllPayments };
