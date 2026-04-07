// merit_aktiva_agent.cjs — Merit Aktiva API integration
// Fetches bank statements via Merit Aktiva v2 API (HMAC-SHA256 auth)
// Credentials: MERIT_AKTIVA_USERNAME (ApiId), MERIT_AKTIVA_PASSWORD (ApiKey)

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
const CACHE_FILE    = path.join(LOG_DIR, 'merit_aktiva_cache.json');

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

function buildSignature(timestamp, body) {
    const payload = API_ID + timestamp + (body ? JSON.stringify(body) : '');
    return crypto.createHmac('sha256', API_KEY).update(payload).digest('hex');
}

/**
 * Generic Merit Aktiva API call with retry + timeout + error logging.
 * @param {string} endpoint - e.g. '/getbankstatement'
 * @param {object|null} body - POST body (null = GET)
 * @param {number} attempt - current retry attempt (internal)
 */
async function meritRequest(endpoint, body = null, attempt = 1) {
    ensureDirs();

    if (!API_ID || !API_KEY) {
        throw new Error('MERIT_AKTIVA_USERNAME / MERIT_AKTIVA_PASSWORD not set in .env.pipeline');
    }

    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); // YYYYMMDDHHmmss
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
                // Save raw response for debugging
                const fname = path.join(RAW_DIR, `merit_${endpoint.replace(/\//g,'_')}_${Date.now()}.json`);
                fs.writeFileSync(fname, raw);

                // 401 Unauthorized
                if (res.statusCode === 401) {
                    const msg = `401 Unauthorized for ${endpoint}. Check credentials.`;
                    logError(msg);
                    return reject(new Error(msg));
                }

                // 429 Rate Limit — exponential backoff retry
                if (res.statusCode === 429) {
                    if (attempt >= MAX_RETRIES) {
                        const msg = `429 Rate Limit hit after ${MAX_RETRIES} retries on ${endpoint}`;
                        logError(msg);
                        return reject(new Error(msg));
                    }
                    const wait = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                    console.warn(`[MeritAktiva] 429 Rate Limit — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                    return meritRequest(endpoint, body, attempt + 1).then(resolve).catch(reject);
                }

                // Non-2xx
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const msg = `HTTP ${res.statusCode} from ${endpoint}: ${raw.slice(0, 200)}`;
                    logError(msg);
                    return reject(new Error(msg));
                }

                // Parse JSON
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    // Save invalid JSON for analysis
                    const badFile = path.join(RAW_DIR, `merit_invalid_json_${Date.now()}.txt`);
                    fs.writeFileSync(badFile, raw);
                    const msg = `Invalid JSON from ${endpoint}, saved to ${badFile}`;
                    logError(msg);
                    reject(new Error(msg));
                }
            });
        });

        // Timeout → fallback to cache
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
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 * @returns {Promise<object[]>} parsed transactions
 */
async function fetchBankStatements(startDate, endDate) {
    const body = {
        StartDate: startDate.replace(/-/g, ''),  // YYYYMMDD
        EndDate:   endDate.replace(/-/g, ''),
    };

    const data = await meritRequest('/getbankstatement', body);

    if (data.fromCache) {
        console.warn('[MeritAktiva] Using cached bank statements');
        return data.transactions || [];
    }

    // Cache successful response
    ensureDirs();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ transactions: data, fetchedAt: new Date().toISOString() }));

    return parseTransactions(data);
}

/**
 * Parse raw Merit Aktiva bank statement rows into normalized format.
 * Handles European number format: "1.234,56" → 1234.56
 */
function parseTransactions(data) {
    const rows = Array.isArray(data) ? data : (data.BankStatement || data.Transactions || data.Lines || []);

    return rows.map((row, i) => {
        const rawAmount = String(row.Amount || row.SumEur || row.Sum || '0');
        const amount = parseEuropeanNumber(rawAmount);

        // Date: prefer ISO, fallback YYYYMMDD → YYYY-MM-DD
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
            account:     row.AccountNo || row.BankAccount || '',
            raw:         row,
        };
    });
}

/**
 * Parse European number format: "1.234,56" → 1234.56, "1234.56" → 1234.56
 */
function parseEuropeanNumber(str) {
    if (!str) return 0;
    const s = String(str).trim();
    // If both . and , present, determine format by last separator
    if (s.includes(',') && s.includes('.')) {
        const lastComma = s.lastIndexOf(',');
        const lastDot   = s.lastIndexOf('.');
        if (lastComma > lastDot) {
            // European: 1.234,56
            return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
        } else {
            // US: 1,234.56
            return parseFloat(s.replace(/,/g, '')) || 0;
        }
    }
    if (s.includes(',')) {
        // European no dot: "1234,56"
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
        // Keep last 100 entries
        const trimmed = existing.slice(-100);
        await ref.set({ merit_aktiva: trimmed }, { merge: true });
    } catch (e) {
        console.warn('[MeritAktiva] Firestore log failed:', e.message);
    }
}

module.exports = { fetchBankStatements, parseTransactions, parseEuropeanNumber, logToFirestore };
