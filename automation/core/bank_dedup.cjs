/**
 * Bank transaction deduplication helper.
 *
 * Builds a deterministic Firestore document ID from key tx fields
 * (companyId + date + amount + reference + counterparty) via SHA-1 hash.
 * Uses `.create()` for atomic idempotent upsert — duplicate attempts fail
 * with ALREADY_EXISTS (gRPC code 6), which we catch and report as skipped.
 *
 * Used by:
 * - accountant_agent.cjs (BANK_STATEMENT interceptor)
 * - imap_daemon.cjs (reconcilePayment archive)
 * - backfill_bank_transactions.cjs (CSV backfill)
 */

const crypto = require('crypto');
const { cleanNum } = require('./utils.cjs');

/**
 * Normalize a field for stable hashing.
 * - null/undefined/empty → '__empty__' (avoids collision between missing values)
 * - dates: coerce DD.MM.YYYY or DD-MM-YYYY to YYYY-MM-DD
 * - amounts: fixed 2-decimal string
 * - strings: trim, lowercase
 */
function normalizeField(name, value) {
    if (value === null || value === undefined || value === '') return '__empty__';

    if (name === 'amount') {
        const n = cleanNum(value);
        if (n === 0 && value !== '0' && value !== 0) return '__empty__';
        return n.toFixed(2);
    }

    if (name === 'date') {
        const s = String(value).trim();
        // ISO YYYY-MM-DD
        const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
        // European DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
        const euro = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
        if (euro) return `${euro[3]}-${String(euro[2]).padStart(2,'0')}-${String(euro[1]).padStart(2,'0')}`;
        return s;
    }

    return String(value).trim().toLowerCase();
}

/**
 * Build deterministic document ID from key transaction fields.
 * Same inputs → same ID, always. Used as Firestore doc ID for atomic dedup.
 *
 * Keeps SHA-1 for backward compatibility with existing bank_transactions
 * documents — changing to SHA-256 here would invalidate every existing
 * doc ID and re-import all historical transactions. The forward-looking
 * SHA-256 lives in `buildContentHash` and is stored as a separate field.
 *
 * @param {object} tx — { companyId, date, amount, reference, counterparty }
 * @returns {string} — 40-char SHA-1 hex digest (legacy compat)
 */
function buildTxKey(tx) {
    const parts = [
        normalizeField('companyId', tx.companyId),
        normalizeField('date', tx.date),
        normalizeField('amount', tx.amount),
        normalizeField('reference', tx.reference),
        normalizeField('counterparty', tx.counterparty),
    ];
    const joined = parts.join('|');
    return crypto.createHash('sha1').update(joined).digest('hex');
}

/**
 * SHA-256 content hash of the raw transaction (M7).
 *
 * Hashes JSON.stringify of the input with sorted keys, so the result
 * depends on field VALUES not field ordering. This catches duplicates
 * that escape `buildTxKey` because of normalization drift — e.g. if
 * a future code change tweaks how dates or amounts are normalized,
 * the legacy txKey would diverge but the content hash stays stable.
 *
 * Stored alongside the doc as `contentHash` field; checked as a
 * secondary signal in `saveBankTransaction` before falling back to
 * the primary doc-id atomic create.
 */
function buildContentHash(tx) {
    // Sorted keys → deterministic JSON regardless of object key order
    const sortedKeys = Object.keys(tx).sort();
    const canonical = sortedKeys
        .filter(k => !k.startsWith('_') && tx[k] !== undefined && tx[k] !== null)
        .map(k => `${k}=${typeof tx[k] === 'object' ? JSON.stringify(tx[k]) : String(tx[k])}`)
        .join('|');
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Idempotently save a bank transaction.
 *
 * Two-layer dedup (M7):
 *   1. Primary: deterministic doc ID via SHA-1 of normalized fields.
 *      Atomic via Firestore `.create()` — second attempt throws
 *      ALREADY_EXISTS, which we catch.
 *   2. Secondary: content hash via SHA-256 of raw input. Before the
 *      .create() call, query bank_transactions where contentHash ==
 *      ours. If hit → duplicate (catches normalization drift).
 *
 * The two layers are belt-and-braces: an entry can be dropped as
 * duplicate by either signal alone.
 *
 * @param {FirebaseFirestore.Firestore} db — Firestore admin instance
 * @param {object} txData — transaction data to save (must include key fields)
 * @returns {Promise<{duplicate: boolean, id: string, dedupBy?: string}>}
 */
async function saveBankTransaction(db, txData) {
    if (!db) throw new Error('saveBankTransaction: db instance required');

    const txId = buildTxKey(txData);
    const contentHash = buildContentHash(txData);
    const ref = db.collection('bank_transactions').doc(txId);

    // ── Secondary layer: contentHash query (catches normalization drift) ──
    // Skipped if companyId is missing — query needs an indexable field
    // and we don't want to scan every tx in the collection.
    if (txData.companyId) {
        try {
            const dupSnap = await db.collection('bank_transactions')
                .where('companyId', '==', txData.companyId)
                .where('contentHash', '==', contentHash)
                .limit(1)
                .get();
            if (!dupSnap.empty) {
                const existingId = dupSnap.docs[0].id;
                console.log(`[bank_dedup] Duplicate by contentHash: ${txData.reference || 'no-ref'} ${txData.amount} (${txData.date}) → ${existingId.slice(0,12)}`);
                return { duplicate: true, id: existingId, dedupBy: 'contentHash' };
            }
        } catch (e) {
            // Query failure (e.g. missing composite index) is non-blocking —
            // fall through to primary dedup. Log so the operator can add the
            // index if it becomes a frequent issue.
            if (!String(e.message || '').includes('contentHash')) {
                console.warn(`[bank_dedup] contentHash query failed (will use primary dedup): ${e.message}`);
            }
        }
    }

    // ── Primary layer: atomic create with deterministic doc ID ──
    try {
        await ref.create({ ...txData, contentHash });
        return { duplicate: false, id: txId };
    } catch (err) {
        // gRPC ALREADY_EXISTS = code 6 (in Firestore Admin SDK)
        if (err && (err.code === 6 || /already exists/i.test(err.message || ''))) {
            console.log(`[bank_dedup] Duplicate by txKey: ${txData.reference || 'no-ref'} ${txData.amount} (${txData.date}) → ${txId.slice(0,12)}`);
            return { duplicate: true, id: txId, dedupBy: 'txKey' };
        }
        throw err;
    }
}

module.exports = { buildTxKey, buildContentHash, saveBankTransaction, normalizeField };
