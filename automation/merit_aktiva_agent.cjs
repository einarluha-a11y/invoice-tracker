// merit_aktiva_agent.cjs — Merit Aktiva API integration
// Fetches bank statements via Merit Aktiva v2 API (HMAC-SHA256 auth)
// Credentials: MERIT_AKTIVA_USERNAME (ApiId), MERIT_AKTIVA_PASSWORD (ApiKey)
//
// Usage (standalone):
//   node merit_aktiva_agent.cjs            → daily import since last run
//   node merit_aktiva_agent.cjs --since 2026-04-01 --until 2026-04-07
//   node merit_aktiva_agent.cjs --dry-run  → fetch + log, no Firestore writes

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.pipeline') });

const API_BASE = process.env.MERIT_AKTIVA_BASE_URL || 'https://aktiva.merit.ee/api/v2';
const API_ID   = process.env.MERIT_AKTIVA_USERNAME;
const API_KEY  = process.env.MERIT_AKTIVA_PASSWORD;

const LOG_DIR       = path.join(__dirname, '..', '_agents');
const RAW_DIR       = path.join(LOG_DIR, 'raw_responses');
const ERROR_LOG     = path.join(LOG_DIR, 'merit_aktiva_errors.log');
const IMPORT_LOG    = path.join(LOG_DIR, 'merit_aktiva.log');
const CACHE_FILE    = path.join(LOG_DIR, 'merit_aktiva_cache.json');
const STATE_FILE    = path.join(LOG_DIR, 'merit_aktiva_state.json');

const TIMEOUT_MS    = 30_000;
const MAX_RETRIES   = 3;

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
    [LOG_DIR, RAW_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function logError(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(ERROR_LOG, line);
    console.error('[MeritAktiva] ERROR:', msg);
}

function logImport(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    ensureDirs();
    fs.appendFileSync(IMPORT_LOG, line);
    console.log('[MeritAktiva]', msg);
}

function dateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function readState() {
    try {
        if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (_) {}
    return {};
}

function saveState(state) {
    ensureDirs();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function buildSignature(timestamp, body) {
    const payload = API_ID + timestamp + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha256', API_KEY).update(payload).digest('hex');
}

/**
 * Generic Merit Aktiva API call with retry + timeout + error logging.
 */
async function meritRequest(endpoint, body = null, attempt = 1) {
    ensureDirs();

    if (!API_ID || !API_KEY) {
        throw new Error('MERIT_AKTIVA_USERNAME / MERIT_AKTIVA_PASSWORD not set in .env.pipeline');
    }

    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const signature = buildSignature(timestamp, body);

    const url = `${API_BASE}${endpoint}?ApiId=${encodeURIComponent(API_ID)}&timestamp=${timestamp}&signature=${signature}`;
    const method = body ? 'POST' : 'GET';
    const postData = body ? JSON.stringify(body) : null;

    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept':       'application/json',
                ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
            },
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', async () => {
                const fname = path.join(RAW_DIR, `merit_${endpoint.replace(/\//g,'_')}_${Date.now()}.json`);
                fs.writeFileSync(fname, raw);

                if (res.statusCode === 401) {
                    const msg = `401 Unauthorized for ${endpoint}. Check credentials.`;
                    logError(msg);
                    return reject(new Error(msg));
                }

                if (res.statusCode === 429) {
                    if (attempt >= MAX_RETRIES) {
                        const msg = `429 Rate Limit hit after ${MAX_RETRIES} retries on ${endpoint}`;
                        logError(msg);
                        return reject(new Error(msg));
                    }
                    const wait = Math.pow(2, attempt) * 1000;
                    console.warn(`[MeritAktiva] 429 Rate Limit — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                    return meritRequest(endpoint, body, attempt + 1).then(resolve).catch(reject);
                }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const msg = `HTTP ${res.statusCode} from ${endpoint}: ${raw.slice(0, 200)}`;
                    logError(msg);
                    return reject(new Error(msg));
                }

                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    const badFile = path.join(RAW_DIR, `merit_invalid_json_${Date.now()}.txt`);
                    fs.writeFileSync(badFile, raw);
                    const msg = `Invalid JSON from ${endpoint}, saved to ${badFile}`;
                    logError(msg);
                    reject(new Error(msg));
                }
            });
        });

        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy();
            const msg = `Timeout (${TIMEOUT_MS}ms) on ${endpoint}`;
            logError(msg);

            if (fs.existsSync(CACHE_FILE)) {
                console.warn('[MeritAktiva] Timeout — using cached response');
                try {
                    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                    resolve({ fromCache: true, ...cached });
                    return;
                } catch (_) {}
            }
            reject(new Error(msg));
        });

        req.on('error', (e) => {
            logError(`Network error on ${endpoint}: ${e.message}`);
            reject(e);
        });

        if (postData) req.write(postData);
        req.end();
    });
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Fetch bank statements for a date range.
 */
async function fetchBankStatements(startDate, endDate) {
    const body = {
        StartDate: startDate.replace(/-/g, ''),
        EndDate:   endDate.replace(/-/g, ''),
    };

    const data = await meritRequest('/getbankstatement', body);

    if (data.fromCache) {
        console.warn('[MeritAktiva] Using cached bank statements');
        return data.transactions || [];
    }

    ensureDirs();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ transactions: data, fetchedAt: new Date().toISOString() }));

    return parseTransactions(data);
}

/**
 * Parse raw Merit Aktiva bank statement rows into normalized format.
 */
function parseTransactions(data) {
    const rows = Array.isArray(data) ? data : (data.BankStatement || data.Transactions || data.Lines || []);

    return rows.map((row, i) => {
        const rawAmount = String(row.Amount || row.SumEur || row.Sum || '0');
        const amount = parseEuropeanNumber(rawAmount);

        let date = row.TransactionDate || row.Date || row.DocDate || '';
        if (/^\d{8}$/.test(date)) {
            date = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
        }

        return {
            index:       i,
            date,
            amount,
            currency:    row.CurrencyCode || row.Currency || 'EUR',
            description: row.Description || row.BankRef || row.Reference || '',
            reference:   row.PaymentRef || row.DocNo || row.InvoiceRef || '',
            counterparty: row.Counterparty || row.PartnerName || row.Payer || '',
            account:     row.AccountNo || row.BankAccount || '',
            raw:         row,
        };
    });
}

/**
 * Parse European number format: "1.234,56" → 1234.56
 */
function parseEuropeanNumber(str) {
    if (!str) return 0;
    const s = String(str).trim();
    if (s.includes(',') && s.includes('.')) {
        const lastComma = s.lastIndexOf(',');
        const lastDot   = s.lastIndexOf('.');
        if (lastComma > lastDot) {
            return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
        } else {
            return parseFloat(s.replace(/,/g, '')) || 0;
        }
    }
    if (s.includes(',')) {
        return parseFloat(s.replace(',', '.')) || 0;
    }
    return parseFloat(s) || 0;
}

/**
 * Log integration event to Firestore config/integration_logs.
 */
async function logToFirestore(event) {
    try {
        const { db } = require('./core/firebase.cjs');
        const ref = db.collection('config').doc('integration_logs');
        const snap = await ref.get();
        const existing = snap.exists ? (snap.data().merit_aktiva || []) : [];
        existing.push({ ...event, ts: new Date().toISOString() });
        const trimmed = existing.slice(-100);
        await ref.set({ merit_aktiva: trimmed }, { merge: true });
    } catch (e) {
        console.warn('[MeritAktiva] Firestore log failed:', e.message);
    }
}

/**
 * Save transactions to Firestore bank_transactions collection.
 * Deduplicates by (date + amount + reference).
 * Returns count of new records saved.
 */
async function saveToFirestore(transactions, companyId, dryRun = false) {
    const { db } = require('./core/firebase.cjs');
    const col = db.collection('bank_transactions');
    let saved = 0;
    let skipped = 0;

    for (const tx of transactions) {
        // Dedup key: date + amount + reference (or description if no reference)
        const dedupKey = `merit_${tx.date}_${tx.amount}_${(tx.reference || tx.description || '').slice(0, 40).replace(/\s+/g, '_')}`;

        const existing = await col.where('dedupKey', '==', dedupKey).limit(1).get();
        if (!existing.empty) {
            skipped++;
            continue;
        }

        const doc = {
            date:        tx.date,
            amount:      tx.amount,
            currency:    tx.currency,
            description: tx.description,
            reference:   tx.reference,
            counterparty: tx.counterparty,
            account:     tx.account,
            source:      'merit_aktiva',
            companyId:   companyId || '',
            dedupKey,
            importedAt:  new Date().toISOString(),
        };

        if (dryRun) {
            console.log('[DRY-RUN] Would save:', JSON.stringify(doc));
        } else {
            await col.add(doc);
        }
        saved++;
    }

    return { saved, skipped };
}

/**
 * Auto-match Merit Aktiva transactions with open invoices.
 * Returns list of matched pairs.
 */
async function autoMatch(transactions, companyId) {
    const { db } = require('./core/firebase.cjs');
    const invoiceSnap = await db.collection('invoices')
        .where('companyId', '==', companyId)
        .where('status', '!=', 'Paid')
        .get();

    const invoices = invoiceSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const matches = [];

    const STOPWORDS = new Set(['logistics','transport','trans','cargo','freight','services','service','group','holding','international','company','solutions','systems','consulting','global','trade','trading']);
    const LEGAL_SUFFIXES = /\b(o[uü]|as|sa|sia|gmbh|llc|ltd|inc|ag|bv|srl|spa)\b/gi;
    const tokenize = (s) => (s || '').toLowerCase().replace(LEGAL_SUFFIXES, ' ').replace(/[^a-zа-яёõäöü0-9\s]/gi, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOPWORDS.has(w));

    for (const tx of transactions) {
        for (const inv of invoices) {
            const invAmount = parseFloat(inv.amount) || 0;
            if (Math.abs(tx.amount - invAmount) > 0.50) continue;

            // Vendor overlap
            const txWords = new Set(tokenize(tx.counterparty + ' ' + tx.description));
            const invWords = new Set(tokenize(inv.vendorName || inv.vendor || ''));
            let overlap = false;
            for (const w of txWords) if (invWords.has(w)) { overlap = true; break; }
            if (!overlap) continue;

            matches.push({ tx, invoiceId: inv.id, invoiceRef: inv.invoiceId, vendor: inv.vendorName || inv.vendor });
        }
    }

    return matches;
}

// ── Daily import (standalone entry point) ────────────────────────────────────

async function runDailyImport({ since, until, dryRun = false } = {}) {
    logImport(`=== Daily import started (dryRun=${dryRun}) ===`);

    if (!API_ID || !API_KEY) {
        logError('Missing credentials — set MERIT_AKTIVA_USERNAME + MERIT_AKTIVA_PASSWORD in .env.pipeline');
        process.exit(1);
    }

    // Determine date range
    const state = readState();
    const startDate = since || state.lastImportDate || dateStr(-30);
    const endDate   = until || dateStr(0);

    logImport(`Fetching ${startDate} → ${endDate}`);

    let transactions;
    try {
        transactions = await fetchBankStatements(startDate, endDate);
    } catch (err) {
        logError(`fetchBankStatements failed: ${err.message}`);
        await logToFirestore({ event: 'import_failed', error: err.message, startDate, endDate });
        process.exit(1);
    }

    logImport(`Fetched ${transactions.length} transaction(s)`);

    // Get companyId from env or config
    const companyId = process.env.MERIT_AKTIVA_COMPANY_ID || state.companyId || '';

    // Save to Firestore
    const { saved, skipped } = await saveToFirestore(transactions, companyId, dryRun);
    logImport(`Saved: ${saved} new, Skipped (dup): ${skipped}`);

    // Auto-match
    if (!dryRun && companyId && transactions.length > 0) {
        try {
            const matches = await autoMatch(transactions, companyId);
            logImport(`Auto-matched: ${matches.length} invoice(s)`);
            for (const m of matches) {
                logImport(`  Match: ${m.tx.date} ${m.tx.amount} → invoice ${m.invoiceRef} (${m.vendor})`);
            }
        } catch (matchErr) {
            logError(`autoMatch failed: ${matchErr.message}`);
        }
    }

    // Update state
    if (!dryRun) {
        saveState({ ...state, lastImportDate: endDate, lastImportAt: new Date().toISOString() });
    }

    await logToFirestore({ event: 'import_ok', saved, skipped, startDate, endDate, dryRun });
    logImport(`=== Done ===`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun  = args.includes('--dry-run');
    const sinceIdx = args.indexOf('--since');
    const untilIdx = args.indexOf('--until');

    runDailyImport({
        since:  sinceIdx >= 0 ? args[sinceIdx + 1] : undefined,
        until:  untilIdx >= 0 ? args[untilIdx + 1] : undefined,
        dryRun,
    }).catch(err => {
        logError(`Unexpected: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { fetchBankStatements, parseTransactions, parseEuropeanNumber, logToFirestore, saveToFirestore, autoMatch };
