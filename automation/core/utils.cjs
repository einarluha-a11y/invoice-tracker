/**
 * Shared utility functions — single source of truth.
 * Used by Scout, Teacher, Accountant, imap_daemon.
 */

const crypto = require('crypto');

/**
 * Compute SHA-256 content hash of a file buffer.
 * Used for idempotency: the same PDF uploaded twice (email re-poll,
 * manual re-upload, re-imported Dropbox file) should never produce
 * two invoice records. Returns a 64-char hex string.
 *
 * NOTE: hash is over the raw bytes, so identical-looking PDFs with
 * different metadata (e.g. re-saved by a different program) will NOT
 * collide — that's intentional, because we rely on separate dedup
 * (invoiceId + vendor + amount) to catch semantic duplicates.
 */
function computeContentHash(buffer) {
    if (!buffer) return null;
    // Accept both Buffer and base64 string inputs for convenience.
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Parse a numeric string into a float, handling European (1.200,50) and US (1,200.50) formats.
 * Strips currency symbols, spaces, and normalizes separators.
 */
function cleanNum(str) {
    if (!str && str !== 0) return 0;
    let s = String(str).replace(/[^\d.,-]/g, '').trim();
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    // At this point s is a plain US-format decimal string. Use Number() for
    // strict parsing — rejects trailing garbage ("10abc" → NaN), then fall
    // back to 0 via isFinite check (handles NaN and ±Infinity).
    const n = Number(s);
    return isFinite(n) ? n : 0;
}

/**
 * Strip all quote characters from vendor names.
 * Handles: "straight", guillemets, arrows, low-high, single quotes
 */
function cleanVendorName(name) {
    if (!name) return name;
    return name
        .replace(/[\u0022\u201C\u201D\u201E\u201F]/g, '')   // двойные кавычки всех видов
        .replace(/[\u0027\u2018\u2019\u201A\u201B]/g, '')   // одиночные кавычки
        .replace(/[\u00AB\u00BB\u2039\u203A]/g, '')          // угловые guillemets
        .replace(/[<>]{1,2}/g, '')                           // стрелки << >>
        .replace(/\s{2,}/g, ' ')                             // двойные пробелы после удаления
        .trim();
}

// ─── Vendor Aliases (cached) ────────────────────────────────────────────────
const _aliasCache = {};
const _aliasCacheTime = {};
const ALIAS_CACHE_TTL = 1800000; // 30 min

const DEFAULT_ALIASES = {
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

/**
 * Get vendor aliases for a company. Reads from Firestore with 30-min cache.
 * Requires `db` from core/firebase.cjs passed as first arg.
 */
async function getVendorAliases(db, companyId) {
    if (!companyId || !db) return { ...DEFAULT_ALIASES };

    const now = Date.now();
    if (_aliasCache[companyId] && now - _aliasCacheTime[companyId] < ALIAS_CACHE_TTL) {
        return { ...DEFAULT_ALIASES, ..._aliasCache[companyId] };
    }

    try {
        const doc = await db.collection('companies').doc(companyId).get();
        if (doc.exists && doc.data().vendorAliases) {
            // Cap cache to 100 entries
            if (Object.keys(_aliasCache).length >= 100) {
                const oldest = Object.keys(_aliasCacheTime).sort((a, b) => _aliasCacheTime[a] - _aliasCacheTime[b])[0];
                delete _aliasCache[oldest];
                delete _aliasCacheTime[oldest];
            }
            _aliasCache[companyId] = doc.data().vendorAliases;
            _aliasCacheTime[companyId] = now;
            return { ...DEFAULT_ALIASES, ...doc.data().vendorAliases };
        }
    } catch (e) {
        console.warn('[Utils] Failed to load vendor aliases:', e.message);
    }
    return { ...DEFAULT_ALIASES };
}

// ─── isEmpty — single source of truth for "value is missing" ────────────────
// Used by Teacher, Repairman, Accountant. Whitespace-only strings are EMPTY.
const EMPTY_STRINGS = new Set(['', 'Not_Found', 'NOT_FOUND_ON_INVOICE', 'not_found',
    'Unknown Vendor', 'UNKNOWN VENDOR', 'Unknown', 'unknown']);

function isEmpty(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === 'number') return val === 0;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '') return true;
        if (EMPTY_STRINGS.has(trimmed)) return true;
        if (trimmed.startsWith('Auto-')) return true;
        return false;
    }
    return false;
}

module.exports = { cleanNum, cleanVendorName, getVendorAliases, isEmpty, computeContentHash };
