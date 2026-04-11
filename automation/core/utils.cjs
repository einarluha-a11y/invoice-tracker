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
 * Parse a numeric string into a float, handling 15 different invoice number
 * formats (M9). Defends against the common ways accountants and exporters
 * mangle numbers across locales.
 *
 * Supported:
 *  1. European  "1.200,50"     → 1200.50
 *  2. US        "1,200.50"     → 1200.50
 *  3. Plain     "1200"         → 1200
 *  4. Plain dec "1200.50"      → 1200.50
 *  5. EU comma  "1200,50"      → 1200.50
 *  6. Currency  "€1,200.50"    → 1200.50
 *  7. Suffix    "1.200,50 EUR" → 1200.50
 *  8. Negative  "-1.200,50"    → -1200.50
 *  9. Parens    "(1200.50)"    → -1200.50  ← M9 fix
 * 10. Trailing  "1200.50-"     → -1200.50  ← M9 fix
 * 11. Spaces    "1 234,56"     → 1234.56   (PL/CZ/RU non-breaking thousands)
 * 12. Apostrof. "1'234.56"     → 1234.56   (Swiss)
 * 13. Indian    "1,23,456.78"  → 123456.78 (lakh grouping)
 * 14. Multi sep "1.000.000,50" → 1000000.50
 * 15. Just sep  ",50"          → 0.50
 *
 * Returns 0 for null/undefined/empty/non-numeric/garbage.
 *
 * Note: scientific notation (1.5e3) is intentionally NOT supported because
 * the digit-only character whitelist strips the 'e', and adding e/E would
 * misparse "Total 5e EUR" style strings. Invoices don't use scientific.
 */
function cleanNum(str) {
    if (!str && str !== 0) return 0;
    let s = String(str);

    // ── 1. Detect parenthesised negatives BEFORE stripping ──
    // Accounting convention: (1234.56) means -1234.56
    let isParensNegative = false;
    const trimmed = s.trim();
    if (/^\s*\(.*\)\s*$/.test(trimmed)) {
        isParensNegative = true;
    }

    // ── 2. Detect trailing minus BEFORE stripping ──
    // Some German/Polish ledger exports write the minus AFTER the number:
    // "1234.56-" or "1.234,56-"
    let isTrailingNegative = false;
    // Strip currency/letters first to find a "real" trailing minus,
    // but only check the digits-and-separators tail
    const tail = trimmed.replace(/[^\d.,\-+()]/g, '');
    if (/[\d.,]-$/.test(tail) && !/^-/.test(tail)) {
        isTrailingNegative = true;
    }

    // ── 3. Strip everything except digits, separators, and a single leading minus ──
    s = s.replace(/[^\d.,-]/g, '').trim();

    // Remove all minus signs except a single leading one (we'll re-apply
    // negatives at the end based on the flags above).
    let leadingNegative = false;
    if (s.startsWith('-')) leadingNegative = true;
    s = s.replace(/-/g, '');

    // ── 4. Decide thousands vs decimal separator ──
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            // EU: dots are thousands, last comma is decimal
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // US/Indian: commas are thousands, last dot is decimal
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        // Only commas — could be thousands or decimal. Heuristic:
        //   single comma followed by exactly 3 digits → thousands ("1,000")
        //   anything else → decimal ("1234,56" or ",50")
        const m = s.match(/^(\d+),(\d{3})$/);
        if (m) {
            s = m[1] + m[2]; // strip thousands separator
        } else {
            s = s.replace(',', '.');
        }
    }
    // (no separators or only dots: nothing to do)

    // ── 5. Parse and apply sign ──
    const n = Number(s);
    if (!isFinite(n)) return 0;

    const negative = leadingNegative || isParensNegative || isTrailingNegative;
    return negative ? -Math.abs(n) : n;
}

/**
 * Street / address / country tokens used to detect when a vendor string has
 * address glued to the company name (e.g. Azure's VendorName often returns
 * "DeepL SE, Maarweg 165, 50825 Cologne, Germany").
 */
const STREET_TOKENS = /\b(str\.|strasse|straße|street|rd\.|road|ave\.?|avenue|blvd\.?|boulevard|weg|platz|pl\.|ul\.|ulica|ulitsa|bulvar|lane|ln\.|tee|tn\.|pst\.|puiestee|улица|просп(ект)?|бульвар|переулок|шоссе|maantee|mnt\.?)\b/i;
const COUNTRY_NAMES = /\b(estonia|eesti|latvia|latvija|lithuania|lietuva|germany|deutschland|poland|polska|russia|россия|usa|united\s+states|uk|united\s+kingdom|england|scotland|finland|suomi|sweden|sverige|france|italy|italia|netherlands|holland|spain|españa|belgium|belgique|austria|österreich|czech|slovakia|slovenia|norway|denmark|ireland|portugal|greece|hungary|romania|bulgaria|malta|cyprus|luxembourg|switzerland|schweiz|iceland|ukraine|belarus|moldova|serbia|croatia|turkey)\b/i;
const POSTAL_LIKE = /\b\d{3,6}[-\s]?\d{0,4}\b/;

/**
 * Strip quotes, address suffixes and extra whitespace from vendor names.
 *
 * Rules:
 * 1. Remove all kinds of quotation marks and decorative angle brackets.
 * 2. Collapse to the first line (OCR sometimes returns multi-line blocks).
 * 3. If a comma is present and what follows looks like an address
 *    (contains digits, street tokens, postal codes, or country names),
 *    cut the string at that comma. Keeps legal suffixes like "Acme, Inc."
 *    because "Inc." contains no address markers.
 */
function cleanVendorName(name) {
    if (!name) return name;
    let cleaned = name
        .replace(/[\u0022\u201C\u201D\u201E\u201F]/g, '')   // двойные кавычки всех видов
        .replace(/[\u0027\u2018\u2019\u201A\u201B]/g, '')   // одиночные кавычки
        .replace(/[\u00AB\u00BB\u2039\u203A]/g, '')          // угловые guillemets
        .replace(/[<>]{1,2}/g, '')                           // стрелки << >>
        .replace(/\s{2,}/g, ' ')                             // двойные пробелы после удаления
        .trim();

    // Take only the first non-empty line (multi-line OCR blocks).
    const firstLine = cleaned.split(/[\r\n]+/).map(s => s.trim()).find(Boolean);
    if (firstLine) cleaned = firstLine;

    // Address suffix stripping: cut at the first comma if tail looks like an address.
    const commaIdx = cleaned.indexOf(',');
    if (commaIdx > 0) {
        const head = cleaned.slice(0, commaIdx).trim();
        const tail = cleaned.slice(commaIdx + 1).trim();
        // Tail is considered "address-ish" if any of these match
        const looksLikeAddress =
            /\d/.test(tail) ||                // contains digits (house nr, postal code)
            STREET_TOKENS.test(tail) ||        // street/road tokens
            POSTAL_LIKE.test(tail) ||          // postal code pattern
            COUNTRY_NAMES.test(tail);          // country name
        if (looksLikeAddress && head.length >= 2) {
            cleaned = head;
        }
    }

    return cleaned.trim();
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
