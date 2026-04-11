const express = require('express');
const cors = require('cors');
const path = require('path');
const { reportError } = require('./error_reporter.cjs');

const { admin, db, bucket, serviceAccount } = require('./core/firebase.cjs');

const app = express();
app.use(cors());
// JSON parser retains the raw request buffer on req.rawBody so the Lemon
// Squeezy webhook handler can verify the HMAC signature against the bytes
// the sender signed. Without `verify`, express.json() would consume the
// stream before the handler gets a chance and signatures would never
// match.
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// --- AUTH MIDDLEWARE ---
// Verifies Firebase ID token and resolves role from Firestore:
//   master_users/{uid} exists  → isMaster=true, userRole='master', accountId=null
//   accounts/{id}/users/{uid}  → userRole from doc.role field, accountId=id
// Falls back to custom claims role if no Firestore record found (legacy support).
async function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.uid = decoded.uid;
        req.email = decoded.email;

        if (db) {
            // 1. Check master_users
            const masterSnap = await db.collection('master_users').doc(decoded.uid).get();
            if (masterSnap.exists) {
                req.isMaster = true;
                req.userRole = 'master';
                req.accountId = null;
                return next();
            }

            // 2. Check accounts/{accountId}/users/{uid}
            const accountsSnap = await db.collection('accounts').get();
            for (const accountDoc of accountsSnap.docs) {
                const userSnap = await db
                    .collection('accounts').doc(accountDoc.id)
                    .collection('users').doc(decoded.uid).get();
                if (userSnap.exists) {
                    req.isMaster = false;
                    req.userRole = userSnap.data().role || 'user';
                    req.accountId = accountDoc.id;
                    return next();
                }
            }
        }

        // 3. Fallback: use custom claims (legacy or no DB)
        req.isMaster = false;
        req.userRole = decoded.role || 'user';
        req.accountId = null;
        // Keep req.role for backwards compat
        req.role = req.userRole;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

function requireRole(roles) {
    return (req, res, next) => {
        const role = req.userRole || req.role;
        if (!role || !roles.includes(role)) {
            return res.status(403).json({ error: 'Forbidden: insufficient role' });
        }
        next();
    };
}

// ── Lemon Squeezy billing webhook ────────────────────────────────────────
// Registered BEFORE the /api verifyToken middleware so HMAC-signed webhooks
// from Lemon Squeezy (which don't carry Firebase ID tokens) can reach the
// handler. The HMAC check is the only trust boundary here — if
// LEMON_WEBHOOK_SECRET is missing the handler fails closed.
const { verifyWebhook, handleLemonWebhook } = require('./billing_service.cjs');
app.post('/api/lemon-webhook', async (req, res) => {
    try {
        const signature = req.headers['x-signature'];
        if (!verifyWebhook(req.rawBody, signature)) {
            console.warn('[Billing] ❌ Webhook signature verification failed');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        const result = await handleLemonWebhook(req.body);
        return res.status(200).json(result);
    } catch (err) {
        console.error('[Billing] webhook handler error:', err);
        await reportError('LEMON_WEBHOOK_ERROR', 'SYSTEM', err).catch(() => {});
        // Return 500 so Lemon Squeezy retries the event — idempotency
        // guarantees a replayed event is a no-op if already applied.
        return res.status(500).json({ error: 'Internal error' });
    }
});

// Protect every other /api/* route with Firebase ID-token verification.
// Exemption: /api/lemon-webhook is registered above and matches first;
// Express runs the route handler before this middleware for that path.
app.use('/api', verifyToken);

// --- SIMPLE IN-MEMORY RATE LIMITER ---
// Protects /api/chat and similar endpoints from abuse without extra deps.
const rateLimitMap = new Map(); // ip -> { count, resetAt }
function rateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = rateLimitMap.get(ip);
        if (!entry || now > entry.resetAt) {
            rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
            return next();
        }
        if (entry.count >= maxRequests) {
            return res.status(429).json({ error: 'Too many requests. Please slow down.' });
        }
        entry.count++;
        next();
    };
}
// Purge stale entries every 5 minutes to prevent memory growth
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
}, 5 * 60 * 1000);

// NOTE: /api/intake (the legacy Zapier webhook) was removed. The Zap that
// used to hit it uploads attachments directly to Dropbox instead, and the
// real invoice ingestion runs through imap_daemon.cjs. Keeping an
// unauthenticated fallback endpoint — even behind a shared secret — just
// widens the attack surface, so it's gone.

// --- REPROCESS INVOICE (on-demand re-extraction via Claude) ---
// Called by the repair button (🔧) in the dashboard TEGEVUS column.
// Downloads the original file from Storage, re-runs Claude extraction,
// and PATCHES the existing Firestore record in-place (never creates a new one).
app.post('/api/reprocess-invoice', rateLimit(10, 60_000), requireRole(['admin', 'master']), async (req, res) => {
    if (!db || !bucket) return res.status(503).json({ error: 'Database unavailable.' });

    const { docId } = req.body;
    if (!docId) return res.status(400).json({ error: 'Missing docId.' });

    try {
        // Step 1: Fetch existing record
        const docRef = db.collection('invoices').doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: `Invoice ${docId} not found.` });

        const existing = docSnap.data();

        // Cross-tenant guard: non-master callers can only reprocess invoices
        // that belong to their own account. Master users bypass this by design
        // (they're operators who legitimately work across tenants).
        if (!req.isMaster && req.accountId && existing.companyId && existing.companyId !== req.accountId) {
            console.warn(`[Reprocess] 🚫 Blocked cross-account reprocess: user=${req.uid} acct=${req.accountId} tried ${docId} (belongs to ${existing.companyId})`);
            return res.status(403).json({ error: 'Invoice does not belong to your account.' });
        }

        const fileUrl = existing.fileUrl;
        if (!fileUrl) return res.status(400).json({ error: 'No fileUrl — cannot reprocess without the original file.' });

        console.log(`[Reprocess] 🔧 Starting re-extraction for ${docId} (${existing.vendorName} / ${existing.invoiceId})`);

        // Step 2: Download file from Firebase Storage via Admin SDK (bypasses token expiry)
        const storageBucket = admin.storage().bucket();
        let filePath;
        if (fileUrl.startsWith('gs://')) {
            filePath = fileUrl.replace(/^gs:\/\/[^/]+\//, '');
        } else {
            const urlObj = new URL(fileUrl);
            filePath = decodeURIComponent(urlObj.pathname.split('/o/')[1].split('?')[0]);
        }
        const fileRef = storageBucket.file(filePath);
        const [fileBuffer] = await fileRef.download();
        const mimeType = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf'
            : filePath.toLowerCase().match(/\.(jpe?g)$/) ? 'image/jpeg' : 'image/png';

        // Step 3: Re-run Claude extraction
        const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

        const { getGlobalAiRules } = require('./core/firebase.cjs');
        const customRules = await getGlobalAiRules();

        const extracted = await processInvoiceWithDocAI(fileBuffer, mimeType, null, customRules);

        if (!extracted || extracted.length === 0 || extracted[0].type === 'JUNK') {
            return res.status(422).json({ error: 'Claude could not extract invoice data from this file.' });
        }

        const fresh = extracted[0];

        // Step 5: Build patch — only update data fields, preserve identity fields
        const patch = {};

        // Always update these if extraction returned real values
        if (fresh.vendorName && fresh.vendorName !== 'UNKNOWN') patch.vendorName = fresh.vendorName;
        if (fresh.invoiceId)          patch.invoiceId = fresh.invoiceId;
        if (fresh.amount > 0)         patch.amount = fresh.amount;
        if (fresh.subtotalAmount > 0) patch.subtotalAmount = fresh.subtotalAmount;
        if (typeof fresh.taxAmount === 'number') patch.taxAmount = fresh.taxAmount;
        if (fresh.currency)           patch.currency = fresh.currency;
        if (fresh.dateCreated)        patch.dateCreated = fresh.dateCreated;
        if (fresh.dueDate)            patch.dueDate = fresh.dueDate;
        if (fresh.supplierVat && fresh.supplierVat !== 'Not_Found')         patch.supplierVat = fresh.supplierVat;
        if (fresh.supplierRegistration && fresh.supplierRegistration !== 'Not_Found') patch.supplierRegistration = fresh.supplierRegistration;
        if (fresh.description)        patch.description = fresh.description;
        if (Array.isArray(fresh.lineItems) && fresh.lineItems.length > 0)   patch.lineItems = fresh.lineItems;
        if (fresh.validationWarnings) patch.validationWarnings = fresh.validationWarnings;

        // Fix status: if record was stuck as Error, promote to Pending
        if (existing.status === 'Error' || existing.status === 'NEEDS_REVIEW') {
            patch.status = 'Pending';
        }

        patch.reprocessedAt = admin.firestore.FieldValue.serverTimestamp();

        // Step 6: Patch Firestore in-place
        await docRef.update(patch);

        console.log(`[Reprocess] ✅ Patched ${docId}: vendor=${patch.vendorName || existing.vendorName}, invoiceId=${patch.invoiceId || existing.invoiceId}, amount=${patch.amount || existing.amount}`);

        res.json({ success: true, patched: patch });

    } catch (err) {
        console.error(`[Reprocess] ❌ Failed for ${docId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- PDF PROXY (bypasses Firebase Storage CORS for the browser) ---
// Fetches the PDF server-side and streams it to the browser — no CORS preflight.
app.get('/api/pdf-proxy', async (req, res) => {
    const { url } = req.query;
    const urlStr = String(url || '');

    // Accept both Firebase Storage HTTPS URLs and gs:// bucket URLs
    const isFirebaseHttps = urlStr.startsWith('https://firebasestorage.googleapis.com/');
    const isGsUrl = urlStr.startsWith('gs://');

    if (!urlStr || (!isFirebaseHttps && !isGsUrl)) {
        return res.status(400).json({ error: 'Missing or invalid url — must be a Firebase Storage URL.' });
    }

    try {
        // Strategy 1: try a direct fetch (works for non-expired download tokens)
        if (isFirebaseHttps) {
            const upstream = await fetch(urlStr);
            if (upstream.ok) {
                const contentType = upstream.headers.get('content-type') || 'application/pdf';
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'private, max-age=300');
                const { Readable } = require('stream');
                Readable.fromWeb(upstream.body).pipe(res);
                return;
            }
            // Fall through to Admin SDK if token is expired/revoked (403/401)
            console.warn(`[PDF Proxy] Direct fetch failed (${upstream.status}), falling back to Admin SDK.`);
        }

        // Strategy 2: Admin SDK download — works for gs:// URLs and expired download tokens
        const storageBucket = admin.storage().bucket();
        let filePath;
        if (isGsUrl) {
            // gs://bucket-name/path/to/file.pdf
            filePath = urlStr.replace(/^gs:\/\/[^/]+\//, '');
        } else {
            // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?...
            const urlObj = new URL(urlStr);
            filePath = decodeURIComponent(urlObj.pathname.split('/o/')[1]);
        }

        const fileRef = storageBucket.file(filePath);
        const [fileBuffer] = await fileRef.download();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(fileBuffer);

    } catch (err) {
        console.error('[PDF Proxy] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- VITAL TELEMETRY API (DASHBOARD) ---
// Restricted to admin/master. Non-privileged users get a 403 — they
// shouldn't see aggregate system metrics across all companies.
app.get('/api/agent-stats', requireRole(['admin', 'master']), async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database unavailable.' });
    try {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        
        // 1. Total invoices explicitly processed in the last 24 hours
        const recentInvoicesQuery = db.collection('invoices').where('createdAt', '>=', oneDayAgo);
        const invSnap = await recentInvoicesQuery.get();
        
        let processed24h = invSnap.docs.length;
        let anomaliesCaught = 0;
        let totalConf = 0;
        let confCount = 0;

        invSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === 'Needs Action' || data.status === 'Error' || data.status === 'ANOMALY_DETECTED' || data.status === 'Duplicate') {
                anomaliesCaught++;
            }
            if (data.confidenceScores && data.confidenceScores.total) {
                totalConf += data.confidenceScores.total;
                confCount++;
            }
        });

        // 2. Count of system telemetry events in system_logs
        const recentLogsQuery = db.collection('system_logs').where('createdAt', '>=', oneDayAgo);
        const logsSnap = await recentLogsQuery.get();
        let errors24h = logsSnap.docs.length;
        
        let aiConfidenceAvg = confCount > 0 ? (totalConf / confCount) : 0.95;

        res.status(200).json({
            status: "success",
            timestamp: now.toISOString(),
            metrics: {
                invoicesProcessed24h: processed24h,
                anomaliesCaught24h: anomaliesCaught,
                systemErrors24h: errors24h,
                averageAiConfidence: parseFloat((aiConfidenceAvg * 100).toFixed(1)) // Returned as percentage (e.g. 95.5)
            }
        });
    } catch (err) {
        console.error('[API] /api/agent-stats failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- GLOBAL EXPRESS ERROR BOUNDARY ---
// Catches malicious payload parsing crashes (e.g., malformed JSON over 50MB) 
// or async hooks that miss local try/catch blocks
app.use(async (err, req, res, next) => {
    console.error('[Express Global Boundary] Caught unhandled exception:', err);
    await reportError('EXPRESS_FATAL_CRASH', req.path || 'UNKNOWN_PATH', err).catch(() => {});
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Export the Express App, rate limiter, and requireRole so they can be used by the primary server
module.exports = app;
module.exports.rateLimit = rateLimit;
module.exports.requireRole = requireRole;
