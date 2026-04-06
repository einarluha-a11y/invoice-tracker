/**
 * Shared utility functions — single source of truth.
 * Used by Scout, Teacher, Accountant, imap_daemon.
 */

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

module.exports = { cleanNum, cleanVendorName };
