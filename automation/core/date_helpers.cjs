/**
 * Date helpers (Minor) — single source of truth for the date math the
 * Teacher/Repairman/sweeper agents do inline in 5+ places.
 *
 * All functions operate on YYYY-MM-DD strings (ISO date) — that's the
 * format Firestore stores `dateCreated` / `dueDate` in. Helpers do the
 * Date object dance internally so callers don't have to.
 *
 * Why a helper module: the inline `new Date(d).getTime() + days*86400000`
 * pattern hits two real bugs in JavaScript date handling:
 *   1. Daylight Saving Time changes — adding 30 days * 86_400_000 ms
 *      lands on the wrong calendar day if a DST boundary is crossed.
 *      addDays() uses setDate() which is DST-safe.
 *   2. Time zone drift — `new Date('2026-04-10').toISOString().slice(0,10)`
 *      can return '2026-04-09' if local TZ is west of UTC. toIsoDate()
 *      uses UTC components to avoid this.
 */

'use strict';

/**
 * True if the string looks like an ISO date (YYYY-MM-DD).
 */
function isIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Today as YYYY-MM-DD in UTC. Stable across server timezones.
 */
function todayIso() {
    const d = new Date();
    return toIsoDate(d);
}

/**
 * Convert a Date object to YYYY-MM-DD using UTC components.
 */
function toIsoDate(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a Date at midnight UTC.
 * Returns null on invalid input.
 */
function parseIsoDate(s) {
    if (!isIsoDate(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Add N days to a YYYY-MM-DD date string. DST-safe via setUTCDate.
 *
 * @param {string} iso     — YYYY-MM-DD
 * @param {number} days    — can be negative
 * @returns {string|null}  — YYYY-MM-DD or null if input was invalid
 */
function addDays(iso, days) {
    const d = parseIsoDate(iso);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return toIsoDate(d);
}

/**
 * Number of days between two YYYY-MM-DD dates (b - a). Negative if b < a.
 * Returns null if either input is invalid.
 */
function daysBetween(aIso, bIso) {
    const a = parseIsoDate(aIso);
    const b = parseIsoDate(bIso);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * True if `iso` is strictly before `today` (overdue check).
 * `iso` may be empty/null/invalid → returns false (treated as not overdue).
 */
function isBeforeToday(iso) {
    if (!isIsoDate(iso)) return false;
    return iso < todayIso();
}

/**
 * Coerce a date string in any of these formats to YYYY-MM-DD:
 *   - ISO YYYY-MM-DD     (passthrough)
 *   - DD.MM.YYYY         (Estonian / German)
 *   - DD/MM/YYYY         (UK)
 *   - DD-MM-YYYY         (Lithuanian / Polish)
 *   - YYYY/MM/DD         (Japanese)
 *
 * Returns the original string unchanged if format unrecognized.
 */
function coerceToIso(s) {
    if (!s || typeof s !== 'string') return '';
    const trimmed = s.trim();
    if (isIsoDate(trimmed)) return trimmed;

    // YYYY/MM/DD
    let m = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

    // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
    m = trimmed.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }

    return trimmed; // unknown format — return as-is
}

module.exports = {
    isIsoDate,
    todayIso,
    toIsoDate,
    parseIsoDate,
    addDays,
    daysBetween,
    isBeforeToday,
    coerceToIso,
};
