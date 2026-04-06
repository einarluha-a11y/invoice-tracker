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
 * @param {object} tx — { companyId, date, amount, reference, counterparty }
 * @returns {string} — 40-char SHA-1 hex digest
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
 * Idempotently save a bank transaction.
 *
 * Uses Firestore `.create()` with deterministic doc ID — second call with
 * identical key fields will throw ALREADY_EXISTS (gRPC code 6), which is
 * caught and reported as `{ duplicate: true }`. First call succeeds normally.
 *
 * @param {FirebaseFirestore.Firestore} db — Firestore admin instance
 * @param {object} txData — transaction data to save (must include key fields)
 * @returns {Promise<{duplicate: boolean, id: string}>}
 */
async function saveBankTransaction(db, txData) {
    if (!db) throw new Error('saveBankTransaction: db instance required');

    const txId = buildTxKey(txData);
    const ref = db.collection('bank_transactions').doc(txId);

    try {
        await ref.create(txData);
        return { duplicate: false, id: txId };
    } catch (err) {
        // gRPC ALREADY_EXISTS = code 6 (in Firestore Admin SDK)
        if (err && (err.code === 6 || /already exists/i.test(err.message || ''))) {
            console.log(`[bank_dedup] Duplicate tx skipped: ${txData.reference || 'no-ref'} ${txData.amount} (${txData.date}) → ${txId.slice(0,12)}`);
            return { duplicate: true, id: txId };
        }
        throw err;
    }
}

module.exports = { buildTxKey, saveBankTransaction, normalizeField };
