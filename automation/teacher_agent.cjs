#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║              TEACHER AGENT — Invoice Extraction Trainer          ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Three operating modes:                                          ║
 * ║                                                                  ║
 * ║  MODE 1: --teach <file.pdf>                                      ║
 * ║    Interactive session: run AI extraction → show results →       ║
 * ║    let you correct wrong fields → save as ground truth example   ║
 * ║    to Firestore collection `invoice_examples`.                   ║
 * ║                                                                  ║
 * ║  MODE 2: --eval [--vendor <name>]                                ║
 * ║    Batch accuracy measurement: for every stored example,         ║
 * ║    re-run extraction and compare against saved ground truth.     ║
 * ║    Prints per-field accuracy report + overall score.             ║
 * ║                                                                  ║
 * ║  MODE 3 (automatic / library):                                   ║
 * ║    getFewShotExamples(vendorHint) — called by document_ai_service║
 * ║    to inject 1–2 verified examples into the Claude prompt.       ║
 * ║    This file exports that function so it can be required.        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node teacher_agent.cjs --teach ./invoice.pdf
 *   node teacher_agent.cjs --teach ./invoice.pdf --vendor "NUNNER Logistics UAB"
 *   node teacher_agent.cjs --eval
 *   node teacher_agent.cjs --eval --vendor "NUNNER"
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs          = require('fs');
const path        = require('path');
const readline    = require('readline');
const { admin, db, bucket } = require('./core/firebase.cjs');
const { cleanNum } = require('./core/utils.cjs');

// ── Colours for terminal output ──────────────────────────────────────────────
const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    red:    '\x1b[31m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    cyan:   '\x1b[36m',
    grey:   '\x1b[90m',
};

// ─────────────────────────────────────────────────────────────────────────────
//  CLAUDE HAIKU — vendor identity extraction from raw text
// ─────────────────────────────────────────────────────────────────────────────

let _anthropic = null;
function getAnthropic() {
    if (_anthropic) return _anthropic;
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return _anthropic;
}

/**
 * Ask Claude Haiku to extract vendor identity AND amounts from raw invoice text.
 * Single call replaces two separate calls (vendor + amounts).
 */
async function extractFromRawText(rawText) {
    if (!process.env.ANTHROPIC_API_KEY) {
        require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
    }
    if (!rawText || !process.env.ANTHROPIC_API_KEY) return null;

    const snippet = rawText.slice(0, 2000);

    try {
        const client = getAnthropic();
        const resp = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{
                role: 'user',
                content: `Extract invoice details from this text. The SUPPLIER (seller/service provider) is NOT the buyer.

Return ONLY valid JSON:
{"vendorName": "...", "supplierVat": "...", "supplierRegistration": "...", "amount": 0, "subtotal": 0, "tax": 0, "currency": "EUR"}

Rules:
- vendorName: the company providing the service/goods (NOT the buyer)
- supplierVat: country code + digits (e.g. LT100018378612, EE102076039)
- supplierRegistration: digits only
- amount: total sum to pay
- subtotal: net amount before tax. If VAT 0% or no tax, subtotal = amount
- tax: VAT amount. If 0% or not shown, tax = 0
- currency: EUR, USD, PLN etc.
- Use empty string "" for text fields not found, 0 for numbers not found.

Invoice text:
${snippet}`
            }],
        });

        const text = resp.content[0]?.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;

        const parsed = JSON.parse(match[0]);
        console.log(`[Teacher] 🤖 Claude: vendor="${parsed.vendorName}", VAT=${parsed.supplierVat}, Reg=${parsed.supplierRegistration}, amount=${parsed.amount} ${parsed.currency}`);
        return parsed;
    } catch (err) {
        console.warn(`[Teacher] Claude extraction failed: ${err.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FIRESTORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const COLLECTION = 'invoice_examples';

/**
 * Save a ground-truth example to Firestore.
 * Documents are keyed by vendorName + invoiceId to avoid accidental duplicates.
 */
async function saveExample(example) {
    if (!db) throw new Error('Firestore not initialised');
    const safeKey = `${example.vendorName}_${example.groundTruth.invoiceId}`
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .slice(0, 80);
    const docRef = db.collection(COLLECTION).doc(safeKey);
    await docRef.set({
        ...example,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return safeKey;
}

/**
 * Retrieve all examples, optionally filtered by vendor name (partial match, case-insensitive).
 */
async function loadExamples(vendorFilter = null) {
    if (!db) throw new Error('Firestore not initialised');
    let ref = db.collection(COLLECTION);
    const snap = await ref.get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (vendorFilter) {
        const q = vendorFilter.toLowerCase();
        docs = docs.filter(d => (d.vendorName || '').toLowerCase().includes(q));
    }
    return docs;
}

/**
 * Smart example lookup: search by VAT number, vendor patterns, or registration code.
 * Used when vendorName is "Unknown Vendor" or empty — the name-based search won't help,
 * but the VAT/RegNo from the PDF can identify the vendor via saved examples.
 *
 * @param {object} invoice - Invoice data with supplierVat, supplierRegistration, etc.
 * @returns {Promise<object[]>} Matching examples
 */
async function findExamplesByIdentifiers(invoice) {
    if (!db) return [];
    const snap = await db.collection(COLLECTION).get();
    const allExamples = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const matches = [];

    const invoiceVat = (invoice.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const invoiceReg = (invoice.supplierRegistration || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    for (const ex of allExamples) {
        const gt = ex.groundTruth || {};

        // Match by VAT number (strongest signal — VAT is unique per company)
        if (invoiceVat.length > 5) {
            const exVat = (gt.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (exVat.length > 5 && exVat === invoiceVat) {
                ex._matchType = 'vat';
                matches.push(ex);
                continue;
            }
        }

        // Match by registration code — BUT skip if invoice already has a valid VAT
        // that differs from the example. This prevents buyer's RegNo (which is the same
        // across all invoices for one company) from matching wrong vendor examples.
        if (invoiceReg.length > 4) {
            const exReg = (gt.supplierRegistration || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (exReg.length > 4 && exReg === invoiceReg) {
                // Safety: if invoice has a VAT and example has a different VAT → likely buyer/supplier confusion
                const exVat = (gt.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (invoiceVat.length > 5 && exVat.length > 5 && invoiceVat !== exVat) {
                    continue; // RegNo matched but VAT differs → probably matched on buyer's RegNo
                }
                ex._matchType = 'reg';
                matches.push(ex);
                continue;
            }
        }

        // Match by vendorPatterns (saved from manual edits on dashboard)
        if (ex.vendorPatterns && Array.isArray(ex.vendorPatterns) && !isEmpty(invoice.vendorName)) {
            const invName = invoice.vendorName.toLowerCase();
            for (const pattern of ex.vendorPatterns) {
                if (pattern && invName.includes(pattern.toLowerCase())) {
                    ex._matchType = 'pattern';
                    matches.push(ex);
                    break;
                }
            }
        }
    }
    return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODE 3 — FEW-SHOT EXAMPLES (exported for document_ai_service.cjs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches 1–2 verified examples from Firestore matching the given vendor hint.
 * Returns a formatted string block ready to inject into the Claude prompt.
 *
 * Called from document_ai_service.cjs before making the Anthropic API call.
 *
 * @param {string|null} vendorHint  - partial vendor name, or null for no filter
 * @param {number}      maxExamples - how many examples to inject (default 2)
 * @returns {Promise<string|null>}  - formatted block, or null if none found
 */
async function getFewShotExamples(vendorHint = null, maxExamples = 2) {
    try {
        if (!db) return null;
        const examples = await loadExamples(vendorHint);
        if (examples.length === 0) return null;

        // Prefer examples that have teachingNotes (more instructive)
        examples.sort((a, b) => (b.teachingNotes ? 1 : 0) - (a.teachingNotes ? 1 : 0));
        const selected = examples.slice(0, maxExamples);

        const lines = ['📚 VERIFIED EXTRACTION EXAMPLES (ground truth from real invoices):'];
        lines.push('These are CORRECT extractions that you MUST use as a reference.\n');

        selected.forEach((ex, i) => {
            lines.push(`--- Example ${i + 1}: ${ex.vendorName} ---`);
            if (ex.documentDescription) {
                lines.push(`Document structure: ${ex.documentDescription}`);
            }
            if (ex.teachingNotes) {
                lines.push(`Key rules: ${ex.teachingNotes}`);
            }
            lines.push('Correct JSON output:');
            lines.push(JSON.stringify(ex.groundTruth, null, 2));
            lines.push('');
        });

        lines.push('END OF EXAMPLES. Apply the same field extraction logic to the current document.');
        return lines.join('\n');
    } catch (err) {
        console.warn(`[TeacherAgent] ⚠️  Could not load few-shot examples: ${err.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CURRENCY CHANGE RULE — single source of truth
// ─────────────────────────────────────────────────────────────────────────────
/**
 * CRITICAL RULE: whenever currency changes, re-extract amount in the new currency.
 * Never keep the old-currency number with a new-currency label.
 *
 * Use this helper EVERYWHERE instead of direct `invoice.currency = X`.
 *
 * @param {object} invoice — the invoice being modified (mutated in place)
 * @param {string} newCurrency — target ISO code (e.g. "EUR")
 * @param {string} source — label for correction log (e.g. "Charter rule", "Example")
 * @param {Array<string>} corrections — corrections array to append to
 * @returns {boolean} true if currency was changed
 */
function setCurrencySafely(invoice, newCurrency, source, corrections) {
    if (!newCurrency || !invoice.currency || invoice.currency === newCurrency) return false;
    const oldCurrency = invoice.currency;
    invoice.currency = newCurrency;
    corrections.push(`${source}: currency ${oldCurrency} → ${newCurrency}`);

    if (invoice.amount <= 0) return true;
    const rawText = invoice._rawText || '';
    if (!rawText) return true;

    // Find all amounts labeled with the new currency in the document
    const re = new RegExp(`([\\d\\s]+[,.]\\d{2})\\s*${newCurrency}\\b`, 'gi');
    const amounts = [...rawText.matchAll(re)].map(m => cleanNum(m[1])).filter(n => n > 0);

    if (amounts.length > 0) {
        // The largest amount labeled with new currency is usually the total
        const newAmount = Math.max(...amounts);
        if (Math.abs(newAmount - invoice.amount) > 0.01) {
            corrections.push(`${source}: amount ${invoice.amount} ${oldCurrency} → ${newAmount} ${newCurrency} (re-extracted from text)`);
            invoice.amount = newAmount;
            invoice.subtotalAmount = newAmount;
            invoice.taxAmount = 0;
        }
    } else {
        corrections.push(`WARNING: ${source} changed currency ${oldCurrency} → ${newCurrency} but no matching amount in rawText. Cleared amount.`);
        invoice.amount = 0;
        invoice.subtotalAmount = 0;
        invoice.taxAmount = 0;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIPELINE MODE — validateAndTeach (called by imap_daemon after Scout)
// ─────────────────────────────────────────────────────────────────────────────

const MANDATORY_FIELDS = [
    'vendorName', 'invoiceId', 'description', 'amount', 'currency',
    'dateCreated', 'dueDate', 'supplierVat', 'supplierRegistration',
    'subtotalAmount', 'taxAmount',
];

const EMPTY_VALUES = ['', 'Not_Found', 'Unknown Vendor', 'UNKNOWN VENDOR', 'Unknown', null, undefined];

function isEmpty(val) {
    if (EMPTY_VALUES.includes(val)) return true;
    if (typeof val === 'number' && val === 0) return true;
    if (typeof val === 'string' && val.startsWith('Auto-')) return true;
    return false;
}

/**
 * Validates and enriches an invoice extracted by the Scout (DocAI).
 * Reads the company Charter (customAiRules) and ground-truth examples,
 * fills missing fields, and applies business rules.
 *
 * @param {object} invoiceData - Raw extraction result from processInvoiceWithDocAI()[0]
 * @param {string} companyId   - Firestore company doc ID
 * @returns {Promise<{approved: boolean, invoice: object, corrections: string[]}>}
 */
async function validateAndTeach(invoiceData, companyId) {
    const invoice = { ...invoiceData };
    const corrections = [];
    const originalCurrency = invoice.currency; // Track for currency-change detection

    // ── 0. SELF-INVOICE GUARD: clear buyer data, re-extract supplier's ──────
    // If invoice's vendorName, supplierVat, or supplierRegistration matches any
    // registered receiving company → Scout extracted buyer's data, not vendor's.
    // After clearing, search rawText for the real supplier's name/Reg/VAT.
    if (db) {
        try {
            const compSnap = await db.collection('companies').get();
            const buyerIds = new Set(); // collect all buyer VAT/Reg to exclude
            const buyerNames = new Set(); // collect buyer names (lowercased, cleaned)
            const invVat = (invoice.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const invReg = (invoice.supplierRegistration || '').replace(/[^0-9]/g, '');
            const invName = (invoice.vendorName || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
            let vatCleared = false, regCleared = false, nameCleared = false;

            for (const cd of compSnap.docs) {
                const c = cd.data();
                const cVat = (c.vat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const cReg = (c.regCode || '').replace(/[^0-9]/g, '');
                const cName = (c.name || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                if (cVat) buyerIds.add(cVat);
                if (cReg) buyerIds.add(cReg);
                if (cName) buyerNames.add(cName);

                // Match VAT directly, or detect regCode embedded in VAT (e.g. "EE14987085" contains regCode "14987085")
                const vatMatchesBuyer = (cVat && invVat && cVat === invVat) ||
                    (cReg && invVat && invVat.endsWith(cReg));
                if (vatMatchesBuyer) {
                    corrections.push(`Self-invoice guard: cleared buyer VAT ${invoice.supplierVat} (belongs to ${c.name})`);
                    invoice.supplierVat = '';
                    vatCleared = true;
                }
                if (cReg && invReg && cReg === invReg) {
                    corrections.push(`Self-invoice guard: cleared buyer Reg ${invoice.supplierRegistration} (belongs to ${c.name})`);
                    invoice.supplierRegistration = '';
                    regCleared = true;
                }
                // Check vendorName — buyer company can never be the vendor
                if (cName && invName && (cName === invName || invName.includes(cName) || cName.includes(invName)) && invName.length > 3) {
                    corrections.push(`Self-invoice guard: vendor "${invoice.vendorName}" is a receiver company (${c.name}) — clearing`);
                    invoice.vendorName = '';
                    nameCleared = true;
                }
            }

            // Re-extract from rawText: find Reg/VAT/vendorName that are NOT buyer's
            if (regCleared || vatCleared || nameCleared) {
                const rawText = invoice._rawText || invoiceData._rawText || '';
                if (rawText) {
                    if (regCleared) {
                        const regMatches = rawText.matchAll(/(?:Reg\.?\s*(?:nr|code|kood)|Rg-?kood)[.:\s]+(\d{6,10})/gi);
                        for (const m of regMatches) {
                            if (!buyerIds.has(m[1])) {
                                invoice.supplierRegistration = m[1];
                                corrections.push(`Self-invoice guard: found supplier Reg ${m[1]} in text`);
                                break;
                            }
                        }
                    }
                    if (vatCleared) {
                        const vatMatches = rawText.matchAll(/(?:KMKR|KMKN|VAT)[.\s:]*([A-Z]{2}\d{6,12})/gi);
                        for (const m of vatMatches) {
                            const clean = m[1].toUpperCase();
                            if (!buyerIds.has(clean)) {
                                invoice.supplierVat = m[1];
                                corrections.push(`Self-invoice guard: found supplier VAT ${m[1]} in text`);
                                break;
                            }
                        }
                    }
                    // Re-extract vendorName: first line of the document is usually the vendor
                    if (nameCleared) {
                        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                        for (const line of lines) {
                            const lineLower = line.toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                            // Skip lines that match buyer names or look like addresses/dates
                            if (buyerNames.has(lineLower)) continue;
                            if (/^\d|^arve|^kuup|^maks|^viitenumber|^swedbank|^seb|^lhv/i.test(line)) continue;
                            if (line.length > 80) continue;
                            // This is likely the vendor name
                            invoice.vendorName = line;
                            corrections.push(`Self-invoice guard: found supplier name "${line}" in text`);
                            break;
                        }
                    }
                }
            }
        } catch { /* non-critical */ }
    }

    // ── 1. Parallel load: Charter + Global Rules + Examples ────────────────
    // All three are independent Firestore reads — run in parallel to save ~300ms
    const vatPrefix = (invoice.supplierVat || '').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();

    const [charterResult, globalRulesResult, examplesResult, globalUiRulesResult] = await Promise.all([
        // Charter (company customAiRules)
        (companyId && db)
            ? db.collection('companies').doc(companyId).get().catch(() => null)
            : Promise.resolve(null),

        // Global rules — batch reads in parallel
        // Payment term query is VAT-independent, always runs if db exists
        db
            ? Promise.all([
                vatPrefix.length === 2 ? db.collection('teacher_global_rules').doc(`vat_${vatPrefix}_currency`).get().catch(() => null) : Promise.resolve(null),
                db.collection('teacher_global_rules').where('type', '==', 'common_payment_term').get().catch(() => null),
                vatPrefix.length === 2 ? db.collection('teacher_global_rules').doc(`vat_${vatPrefix}_taxrate`).get().catch(() => null) : Promise.resolve(null),
              ])
            : Promise.resolve([null, null, null]),

        // Examples — by vendor name first
        (invoice.vendorName && !isEmpty(invoice.vendorName))
            ? loadExamples(invoice.vendorName).catch(() => [])
            : Promise.resolve([]),

        // Global UI rules (from Settings → Reeglid) — applies to ALL companies
        db
            ? db.collection('config').doc('global_ai_rules').get().catch(() => null)
            : Promise.resolve(null),
    ]);

    // ── 1a. Extract Charter rules + append global UI rules ──────────────────
    let charterRules = '';
    if (charterResult && charterResult.exists) {
        charterRules = charterResult.data().customAiRules || '';
    }
    // Global rules from Settings UI apply to ALL receiving companies
    if (globalUiRulesResult && globalUiRulesResult.exists) {
        const globalText = globalUiRulesResult.data().customAiRules || '';
        if (globalText.trim()) {
            charterRules = charterRules ? `${globalText}\n${charterRules}` : globalText;
        }
    }

    // ── 1a2. Apply Charter rules FIRST (vendor-specific overrides) ──────────
    // Must run before global fallbacks so vendor-specific rules win.
    if (charterRules) {
        const rulesApplied = applyCharterRules(invoice, charterRules);
        corrections.push(...rulesApplied);
    }

    // ── 1b. Apply global rules ──────────────────────────────────────────────
    const [currencyRuleDoc, termsSnap, taxRuleDoc] = globalRulesResult;

    // VAT country → currency (uses safe setter: re-extracts amount from text)
    if (currencyRuleDoc && currencyRuleDoc.exists) {
        const rule = currencyRuleDoc.data();
        if (rule.count >= 2 && rule.value && invoice.currency !== rule.value) {
            setCurrencySafely(invoice, rule.value, `Global rule VAT ${vatPrefix}`, corrections);
        }
    }

    // Most common payment term → dueDate fallback
    if (invoice.dateCreated && (!invoice.dueDate || isEmpty(invoice.dueDate) || invoice.dueDate === invoice.dateCreated)) {
        if (termsSnap && !termsSnap.empty) {
            let bestTerm = null;
            let bestCount = 0;
            termsSnap.forEach(d => {
                const data = d.data();
                if (data.count > bestCount) { bestCount = data.count; bestTerm = data; }
            });
            if (bestTerm && bestCount >= 5) {
                const days = parseInt(bestTerm.value.replace('net-', ''));
                if (days > 0) {
                    const d = new Date(invoice.dateCreated);
                    d.setDate(d.getDate() + days);
                    invoice.dueDate = d.toISOString().split('T')[0];
                    corrections.push(`Global rule: fallback dueDate = dateCreated + ${days} days (most common term, ${bestCount} invoices)`);
                }
            }
        }
    }

    // VAT country → tax rate (validation)
    if (taxRuleDoc && taxRuleDoc.exists && invoice.amount > 0 && invoice.subtotalAmount > 0) {
        const rule = taxRuleDoc.data();
        if (rule.count >= 3 && rule.value > 0) {
            const actualRate = invoice.subtotalAmount > 0
                ? Math.round((invoice.taxAmount / invoice.subtotalAmount) * 100)
                : 0;
            if (actualRate === 0 && rule.value > 0 && invoice.taxAmount === 0) {
                const expectedTax = parseFloat((invoice.subtotalAmount * rule.value / 100).toFixed(2));
                const expectedTotal = parseFloat((invoice.subtotalAmount + expectedTax).toFixed(2));
                if (Math.abs(expectedTotal - invoice.amount) < 0.10) {
                    invoice.taxAmount = expectedTax;
                    corrections.push(`Global rule: calculated tax ${expectedTax} (${rule.value}% for ${vatPrefix}, ${rule.count} samples)`);
                }
            }
        }
    }

    // ── 2. Examples — fallback to VAT/RegNo search if name search found nothing ──
    let examples = examplesResult;
    if (examples.length === 0) {
        try {
            examples = await findExamplesByIdentifiers(invoice);
            if (examples.length > 0) {
                console.log(`[Teacher] Found ${examples.length} example(s) by VAT/RegNo/patterns match`);
            }
        } catch { /* no match — proceed without examples */ }
    }

    // ── 2c. SELF-INVOICE GUARD: strip buyer's VAT/Reg from examples ────────
    // If an example's groundTruth VAT/Reg matches any registered receiving company,
    // those fields were saved from the buyer section — ignore them.
    if (examples.length > 0 && companyId && db) {
        try {
            const companiesSnap = await db.collection('companies').get();
            const receiverIds = new Set();
            companiesSnap.docs.forEach(d => {
                const c = d.data();
                if (c.vat) receiverIds.add(c.vat.replace(/[^a-zA-Z0-9]/g, '').toUpperCase());
                if (c.regCode) receiverIds.add(c.regCode.replace(/[^0-9]/g, ''));
            });

            for (const ex of examples) {
                const gt = ex.groundTruth || {};
                const exVat = (gt.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const exReg = (gt.supplierRegistration || '').replace(/[^0-9]/g, '');
                if (exVat && receiverIds.has(exVat)) {
                    console.log(`[Teacher] ⚠️ Example "${ex.vendorName}" has buyer VAT ${gt.supplierVat} — ignoring`);
                    gt.supplierVat = '';
                }
                if (exReg && receiverIds.has(exReg)) {
                    console.log(`[Teacher] ⚠️ Example "${ex.vendorName}" has buyer Reg ${gt.supplierRegistration} — ignoring`);
                    gt.supplierRegistration = '';
                }
            }
        } catch { /* non-critical */ }
    }

    // ── 3. Fill/correct fields from examples ────────────────────────────────
    // Sort once, reuse in step 3 and step 5
    const bestExample = examples.length > 0
        ? examples.sort((a, b) => {
              const tA = a.updatedAt?._seconds || a.createdAt?._seconds || 0;
              const tB = b.updatedAt?._seconds || b.createdAt?._seconds || 0;
              return tB - tA;
          })[0]
        : null;

    if (bestExample) {
        const gt = bestExample.groundTruth || {};

        // Vendor name: example ALWAYS wins (DocAI often confuses buyer/supplier)
        if (gt.vendorName && !isEmpty(gt.vendorName) && invoice.vendorName !== gt.vendorName) {
            if (!isEmpty(invoice.vendorName)) {
                corrections.push(`Corrected vendorName: ${invoice.vendorName} → ${gt.vendorName} (from example)`);
            } else {
                corrections.push(`Filled vendorName from example: ${gt.vendorName}`);
            }
            invoice.vendorName = gt.vendorName;
        }

        // Static vendor fields: examples ALWAYS override DocAI (manual correction = trusted)
        // Currency uses setCurrencySafely() to auto re-extract amount from text.
        const STATIC_SIMPLE_FIELDS = ['supplierVat', 'supplierRegistration'];
        for (const field of STATIC_SIMPLE_FIELDS) {
            if (!gt[field] || isEmpty(gt[field])) continue;
            if (invoice[field] !== gt[field]) {
                if (!isEmpty(invoice[field])) {
                    corrections.push(`Corrected ${field}: ${invoice[field]} → ${gt[field]} (from example)`);
                } else {
                    corrections.push(`Filled ${field} from example: ${gt[field]}`);
                }
                invoice[field] = gt[field];
            }
        }
        // Currency: use safe setter (re-extracts amount from rawText in new currency)
        if (gt.currency && !isEmpty(gt.currency) && invoice.currency !== gt.currency) {
            setCurrencySafely(invoice, gt.currency, 'Example', corrections);
        }

        // Amount fix: if any example has same invoiceId and DocAI amount is wildly different,
        // DocAI likely parsed amount in wrong currency (e.g. PLN instead of EUR)
        const exactMatch = examples.find(ex => {
            const exId = (ex.groundTruth?.invoiceId || '').toLowerCase().trim();
            const invId = (invoice.invoiceId || '').toLowerCase().trim();
            return exId && invId && exId === invId;
        });
        if (exactMatch && invoice.amount > 0) {
            const egt = exactMatch.groundTruth;
            if (egt.amount > 0) {
                const ratio = invoice.amount / egt.amount;
                if (ratio > 1.5 || ratio < 0.5) {
                    corrections.push(`Fixed amount: ${invoice.amount} → ${egt.amount} (example match by invoiceId, DocAI had wrong currency)`);
                    invoice.amount = egt.amount;
                    invoice.subtotalAmount = egt.subtotalAmount || egt.amount;
                    invoice.taxAmount = egt.taxAmount || 0;
                }
            }
            // Also pick Reg from exact match (more precise than latest example)
            if (egt.supplierRegistration && egt.supplierRegistration !== invoice.supplierRegistration) {
                corrections.push(`Corrected supplierRegistration: ${invoice.supplierRegistration} → ${egt.supplierRegistration} (exact invoiceId match)`);
                invoice.supplierRegistration = egt.supplierRegistration;
            }
        }

        // Description: copy pattern from example if Scout returned empty
        if (isEmpty(invoice.description) && gt.description && !isEmpty(gt.description)) {
            invoice.description = gt.description;
            corrections.push(`Filled description from example: ${gt.description}`);
        }

        // Apply teachingNotes if available (vendor-specific rules)
        if (bestExample.teachingNotes) {
            console.log(`[Teacher] Applying teaching notes for ${bestExample.vendorName}: ${bestExample.teachingNotes}`);
        }
    }

    // Charter rules already applied in step 1a2 (before global fallbacks)

    // ── 4a. VENDOR NAME CLEANUP: strip trailing \n + city lines ─────────────
    // DocAI sometimes extracts multi-line text as vendorName:
    //   "FFC LOGISTICS\nKOHTLA-JÄRVE" → "FFC LOGISTICS"
    //   "NUNNER LOGISTICS OÜ\nTALLINN\nEE123456" → "NUNNER LOGISTICS OÜ"
    // Keep only the first non-empty line.
    if (invoice.vendorName && invoice.vendorName.includes('\n')) {
        const firstLine = invoice.vendorName.split('\n').map(s => s.trim()).find(s => s.length > 0);
        if (firstLine && firstLine !== invoice.vendorName) {
            corrections.push(`Vendor cleanup: stripped multi-line (kept "${firstLine}")`);
            invoice.vendorName = firstLine;
        }
    }

    // ── 4b. LEGAL NAME RULE: vendor name must include company suffix ────────
    // DocAI often extracts logo text ("SMC", "electrobit") instead of the legal name
    // ("SMC Automation OÜ", "Electrobit OÜ"). Search rawText lines for full name.
    {
        const SUFFIXES = ['AS', 'OÜ', 'OU', 'OY', 'AB', 'GmbH', 'AG', 'SIA', 'UAB', 'BV', 'NV', 'Ltd', 'LLC', 'Inc', 'SRL', 'SARL', 'SAS', 'SE', 'KG', 'MB'];
        const hasSuffix = (name) => SUFFIXES.some(s => new RegExp(`(?:^|\\s)${s}(?:\\s|$|,|\\.)`, 'i').test(name));

        if (invoice.vendorName && !hasSuffix(' ' + invoice.vendorName + ' ')) {
            const rawText = invoice._rawText || invoiceData._rawText || '';
            if (rawText) {
                const vendorLower = invoice.vendorName.toLowerCase().trim();
                // Split into lines, find lines that contain vendorName AND a legal suffix
                const candidates = rawText.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.toLowerCase().includes(vendorLower) && hasSuffix(l) && l.length < 60);

                if (candidates.length > 0) {
                    // Pick shortest candidate (most specific)
                    let best = candidates.sort((a, b) => a.length - b.length)[0];
                    // Normalize "OU" → "OÜ" (ASCII fallback in Estonian PDFs)
                    best = best.replace(/\bOU\b/g, 'OÜ');
                    if (best !== invoice.vendorName) {
                        corrections.push(`Legal name: ${invoice.vendorName} → ${best} (found in document text)`);
                        invoice.vendorName = best;
                    }
                }
            }
        }
    }

    // ── 5. Cross-validation + math check — one Claude call if needed ────────
    // Detects: unknown vendor, missing identity, VAT mismatch, wrong-currency amounts.
    // If any issue found → single Claude Haiku call extracts vendor + amounts from rawText.
    {
        const rawText = invoice._rawText || invoiceData._rawText || '';
        const currencyWasChanged = originalCurrency !== invoice.currency;

        // Check identity issues
        const missingIdentity =
            isEmpty(invoice.vendorName) ||
            isEmpty(invoice.supplierVat) ||
            isEmpty(invoice.supplierRegistration);

        // Check VAT mismatch with example (different company, same name)
        let vatMismatch = false;
        if (examples.length > 0 && bestExample) {
            const exGt = bestExample.groundTruth || {};
            if (exGt.supplierVat && !isEmpty(invoice.supplierVat) && !isEmpty(exGt.supplierVat)) {
                const invVat = invoice.supplierVat.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const exVat = exGt.supplierVat.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (invVat !== exVat) {
                    vatMismatch = true;
                    corrections.push(`WARNING: VAT mismatch — invoice ${invoice.supplierVat} vs example ${exGt.supplierVat}`);
                }
            }
        }

        // Check math: subtotal + tax ≈ amount
        let mathWrong = false;
        if (invoice.amount > 0 && invoice.subtotalAmount > 0) {
            const computed = parseFloat((invoice.subtotalAmount + invoice.taxAmount).toFixed(2));
            const ratio = invoice.subtotalAmount / invoice.amount;
            if (Math.abs(computed - invoice.amount) > 0.05) {
                if (ratio > 1.5 || ratio < 0.5) {
                    mathWrong = true; // wildly off — likely wrong currency
                } else {
                    corrections.push(`WARNING: Math mismatch: ${invoice.subtotalAmount} + ${invoice.taxAmount} = ${computed} ≠ ${invoice.amount}`);
                    // Non-blocking flag for UI badge — does not affect status
                    invoice.mathMismatch = true;
                }
            } else if (invoice.mathMismatch) {
                // Math now correct — clear stale flag
                delete invoice.mathMismatch;
            }
        }

        // Single Claude call if any issue detected
        const needsClaude = missingIdentity || vatMismatch || (mathWrong && currencyWasChanged);
        if (needsClaude && rawText) {
            const claude = await extractFromRawText(rawText);
            if (claude) {
                // Fix vendor identity
                if (claude.vendorName && (isEmpty(invoice.vendorName) || vatMismatch)) {
                    corrections.push(`Claude: vendor "${invoice.vendorName}" → "${claude.vendorName}"`);
                    invoice.vendorName = claude.vendorName;
                }
                if (claude.supplierVat && (isEmpty(invoice.supplierVat) || vatMismatch)) {
                    corrections.push(`Claude: supplierVat = ${claude.supplierVat}`);
                    invoice.supplierVat = claude.supplierVat;
                }
                if (claude.supplierRegistration && (isEmpty(invoice.supplierRegistration) || vatMismatch)) {
                    corrections.push(`Claude: supplierRegistration = ${claude.supplierRegistration}`);
                    invoice.supplierRegistration = claude.supplierRegistration;
                }
                // Fix amounts if Claude returned them and math was wrong
                if (mathWrong && claude.amount > 0) {
                    corrections.push(`Claude: amount ${invoice.amount} → ${claude.amount} ${claude.currency || invoice.currency}`);
                    invoice.amount = claude.amount;
                    invoice.subtotalAmount = claude.subtotal || claude.amount;
                    invoice.taxAmount = claude.tax || 0;
                }
            }
        }

        // Re-apply self-invoice guard after Claude (Claude also confuses buyer/supplier)
        // Checks VAT, Reg, AND vendorName — receiver company can never be vendor
        if (db) {
            try {
                const compSnap2 = await db.collection('companies').get();
                const buyerIds2 = new Set();
                const buyerNames2 = new Set();
                const postVat = (invoice.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const postReg = (invoice.supplierRegistration || '').replace(/[^0-9]/g, '');
                const postName = (invoice.vendorName || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                let vatCleared2 = false, regCleared2 = false, nameCleared2 = false;

                for (const cd of compSnap2.docs) {
                    const c = cd.data();
                    const cVat = (c.vat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                    const cReg = (c.regCode || '').replace(/[^0-9]/g, '');
                    const cName = (c.name || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                    if (cVat) buyerIds2.add(cVat);
                    if (cReg) buyerIds2.add(cReg);
                    if (cName) buyerNames2.add(cName);
                    if ((cVat && postVat && cVat === postVat) || (cReg && postVat && postVat.endsWith(cReg))) {
                        corrections.push(`Post-Claude guard: cleared buyer VAT (belongs to ${c.name})`);
                        invoice.supplierVat = '';
                        vatCleared2 = true;
                    }
                    if (cReg && postReg && cReg === postReg) {
                        corrections.push(`Post-Claude guard: cleared buyer Reg (belongs to ${c.name})`);
                        invoice.supplierRegistration = '';
                        regCleared2 = true;
                    }
                    // vendorName check — Claude might have put buyer name here
                    if (cName && postName && (cName === postName || postName.includes(cName) || cName.includes(postName)) && postName.length > 3) {
                        corrections.push(`Post-Claude guard: cleared buyer vendor name "${invoice.vendorName}" (belongs to ${c.name})`);
                        invoice.vendorName = '';
                        nameCleared2 = true;
                    }
                }

                // Re-extract from rawText after clearing Claude's buyer data
                if (regCleared2 || vatCleared2 || nameCleared2) {
                    if (regCleared2) {
                        const regMs = rawText.matchAll(/(?:Reg\.?\s*(?:nr|code|kood)|Rg-?kood)[.:\s]+(\d{6,10})/gi);
                        for (const m of regMs) { if (!buyerIds2.has(m[1])) { invoice.supplierRegistration = m[1]; break; } }
                    }
                    if (vatCleared2) {
                        const vatMs = rawText.matchAll(/(?:KMKR|KMKN|VAT)[.\s:]*([A-Z]{2}\d{6,12})/gi);
                        for (const m of vatMs) { if (!buyerIds2.has(m[1].toUpperCase())) { invoice.supplierVat = m[1]; break; } }
                    }
                    if (nameCleared2) {
                        // Find first non-buyer non-generic line in raw text
                        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                        for (const line of lines) {
                            const lineLower = line.toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                            if (buyerNames2.has(lineLower)) continue;
                            if (/^\d|^arve|^kuup|^maks|^viitenumber|^swedbank|^seb|^lhv/i.test(line)) continue;
                            if (line.length > 80) continue;
                            invoice.vendorName = line;
                            corrections.push(`Post-Claude guard: re-extracted supplier name "${line}" from text`);
                            break;
                        }
                    }
                }
            } catch { /* non-critical */ }
        }

        // Fallback: if math still wrong after Claude, reset subtotal = amount
        if (mathWrong && invoice.subtotalAmount > 0) {
            const ratio = invoice.subtotalAmount / invoice.amount;
            if (ratio > 1.5 || ratio < 0.5) {
                corrections.push(`Fixed: subtotal ${invoice.subtotalAmount} reset to ${invoice.amount}`);
                invoice.subtotalAmount = invoice.amount;
                invoice.taxAmount = 0;
            }
        }
    }

    // ── 7. Completeness check ───────────────────────────────────────────────
    const missing = MANDATORY_FIELDS.filter(f => isEmpty(invoice[f]));

    const approved = missing.length === 0;

    if (!approved) {
        console.log(`[Teacher] ⚠ Missing fields after validation: ${missing.join(', ')}`);
    }
    if (corrections.length > 0) {
        console.log(`[Teacher] ✅ Applied ${corrections.length} correction(s): ${corrections.join('; ')}`);
    }

    // Attach teacher corrections as metadata
    invoice.teacherCorrections = corrections;

    return { approved, invoice, corrections };
}

/**
 * Apply company-specific rules from customAiRules text.
 * Rules are stored as free-text in Firestore; we parse known patterns.
 *
 * Supported patterns:
 *   'If you see "X", the correct name is "Y".'  → vendor name normalization
 *   'Vendor "X": net-30'                         → dueDate = dateCreated + N days
 *   'Vendor "X": description = "Y"'              → default description
 *   'Vendor "X": currency = "EUR"'               → force currency
 */
/**
 * Normalize rules text from any language (RU/ET/EN) to canonical English format.
 * Runs on every loaded rule line — if it matches a known non-English pattern,
 * replaces with the canonical English equivalent so the parser only needs to
 * understand one form. Unknown/untranslatable lines are kept as-is.
 */
function normalizeRulesText(rulesText) {
    if (!rulesText) return '';
    return rulesText.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // ── Due date rules ──────────────────────────────────────────────────
        // RU: "Для вендора X срок оплаты = дата инвойса + N дней"
        // RU: "Для вендоров X и Y срок оплаты = дата инвойса + N дней" (multiple)
        const ruDueMulti = trimmed.match(/^[Дд]ля\s+вендор(?:а|ов|у)?\s+(.+?)\s+срок\s+оплаты\s*=\s*дата\s+инвойса\s*\+\s*(\d+)\s*дн/i);
        if (ruDueMulti) {
            const [, vendors, days] = ruDueMulti;
            // Handle "X и Y", "X, Y", "X and Y"
            const names = vendors.split(/\s+и\s+|\s*,\s*|\s+and\s+/i).map(n => n.trim()).filter(Boolean);
            return names.map(n => `Vendor "${n}": net-${days}`).join('\n');
        }
        // ET: 'Müüja "X": maksetähtaeg = arve kuupäev + N päeva'
        const etDue = trimmed.match(/^[Mm]üüja\s*[""\u201c\u201d]?(.+?)[""\u201c\u201d]?:?\s*maksetähtaeg\s*=\s*arve\s+kuupäev\s*\+\s*(\d+)\s*päeva/i);
        if (etDue) return `Vendor "${etDue[1].trim()}": net-${etDue[2]}`;

        // ── Currency rules ──────────────────────────────────────────────────
        // RU: 'Для вендора X валюта = "EUR"'
        const ruCurr = trimmed.match(/^[Дд]ля\s+вендор(?:а|ов|у)?\s+(.+?)\s+валюта\s*=\s*[""\u201c\u201d]?([A-Z]{3})[""\u201c\u201d]?/i);
        if (ruCurr) return `Vendor "${ruCurr[1].trim()}": currency = "${ruCurr[2].toUpperCase()}"`;
        // ET: 'Müüja "X": valuuta = "EUR"'
        const etCurr = trimmed.match(/^[Mm]üüja\s*[""\u201c\u201d]?(.+?)[""\u201c\u201d]?:?\s*valuuta\s*=\s*[""\u201c\u201d]?([A-Z]{3})[""\u201c\u201d]?/i);
        if (etCurr) return `Vendor "${etCurr[1].trim()}": currency = "${etCurr[2].toUpperCase()}"`;

        // ── Description rules ───────────────────────────────────────────────
        // RU: 'Для вендора X описание = "Y"'
        const ruDesc = trimmed.match(/^[Дд]ля\s+вендор(?:а|ов|у)?\s+(.+?)\s+описание\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (ruDesc) return `Vendor "${ruDesc[1].trim()}": description = "${ruDesc[2]}"`;
        // ET: 'Müüja "X": kirjeldus = "Y"'
        const etDesc = trimmed.match(/^[Mm]üüja\s*[""\u201c\u201d]?(.+?)[""\u201c\u201d]?:?\s*kirjeldus\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (etDesc) return `Vendor "${etDesc[1].trim()}": description = "${etDesc[2]}"`;

        // ── Vendor name correction ──────────────────────────────────────────
        // RU: 'Если видишь "OLD", правильное название "NEW"'
        const ruName = trimmed.match(/^[Ее]сли\s+видишь\s+[""\u201c\u201d](.+?)[""\u201c\u201d],?\s*правильное\s+(?:официальное\s+)?название\s+[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (ruName) return `If you see "${ruName[1]}", the correct name is "${ruName[2]}".`;
        // ET: 'Kui näed "OLD", õige nimi on "NEW"'
        const etName = trimmed.match(/^[Kk]ui\s+näed\s+[""\u201c\u201d](.+?)[""\u201c\u201d],?\s*õige\s+(?:ametlik\s+)?nimi\s+on\s+[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (etName) return `If you see "${etName[1]}", the correct name is "${etName[2]}".`;

        // Already canonical or unknown → keep as-is
        return line;
    }).join('\n');
}

function applyCharterRules(invoice, rulesText) {
    // Normalize RU/ET rules to canonical English form first
    rulesText = normalizeRulesText(rulesText);
    const applied = [];
    const rules = rulesText.split('\n').filter(r => r.trim());
    // Track which (field, vendor) combinations were already set — first matching rule wins
    const lockedFields = new Set();

    // Helper: check if this rule's vendor matches the current invoice
    // Strips legal suffixes (OÜ, AS, GmbH, etc.) and compares base names
    function vendorMatch(ruleVendor) {
        if (!invoice.vendorName) return false;
        // Use (^|\s|,|\.) instead of \b — \b doesn't work with Unicode (Ü, Ä, etc.)
        const stripSuffix = (s) => s.toLowerCase()
            .replace(/[\s\n]+/g, ' ')
            .replace(/(^|\s|,|\.)(as|oü|ou|oy|ab|gmbh|ag|sia|uab|bv|nv|ltd|llc|inc|mtü|sarl|sas|sp\.?\s*z\s*o\.?\s*o\.?|mb)(\s|$|,|\.)/gi, ' ')
            .replace(/[^a-z0-9]/gi, '')
            .trim();
        const invName = stripSuffix(invoice.vendorName);
        const ruleName = stripSuffix(ruleVendor);
        if (!invName || !ruleName || ruleName.length < 3) return false;
        return invName.includes(ruleName) || ruleName.includes(invName);
    }

    for (const rule of rules) {
        // Vendor name correction: If you see "OLD", the correct name is "NEW".
        const nameMatch = rule.match(/If you see [""\u201c\u201d](.+?)[""\u201c\u201d],?\s*the correct (?:official )?name is [""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (nameMatch) {
            const [, oldName, newName] = nameMatch;
            if (vendorMatch(oldName)) {
                invoice.vendorName = newName;
                applied.push(`Charter: renamed vendor "${oldName}" → "${newName}"`);
            }
            continue;
        }

        // Due date rule (canonical): Vendor "X": net-30
        const dueMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*net-?(\d+)/i);
        if (dueMatch) {
            const [, vendor, days] = dueMatch;
            const cleanVendor = vendor.replace(/[""\u201c\u201d.]/g, '').trim();
            if (vendorMatch(cleanVendor) && invoice.dateCreated && !lockedFields.has('dueDate')) {
                // Charter rule has priority — ALWAYS overrides DocAI extraction
                // First matching rule locks the field, subsequent rules ignored
                const d = new Date(invoice.dateCreated);
                d.setDate(d.getDate() + parseInt(days));
                const newDueDate = d.toISOString().split('T')[0];
                if (invoice.dueDate !== newDueDate) {
                    const oldDueDate = invoice.dueDate;
                    invoice.dueDate = newDueDate;
                    applied.push(`Charter: set dueDate = dateCreated + ${days} days for "${cleanVendor}"${oldDueDate ? ` (was ${oldDueDate})` : ''}`);
                }
                lockedFields.add('dueDate');
            }
            continue;
        }

        // Currency rule: Vendor "X": currency = "EUR"
        // Uses setCurrencySafely() — auto re-extracts amount from text in new currency
        const currMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*currency\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (currMatch) {
            const [, vendor, curr] = currMatch;
            if (vendorMatch(vendor) && invoice.currency !== curr && !lockedFields.has('currency')) {
                setCurrencySafely(invoice, curr, `Charter rule for "${vendor}"`, applied);
                lockedFields.add('currency');
            }
            continue;
        }

        // Default description: Vendor "X": description = "Y"
        const descMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*description\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (descMatch) {
            const [, vendor, desc] = descMatch;
            if (vendorMatch(vendor) && isEmpty(invoice.description) && !lockedFields.has('description')) {
                invoice.description = desc;
                applied.push(`Charter: set description = "${desc}" for "${vendor}"`);
                lockedFields.add('description');
            }
            continue;
        }
    }

    return applied;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODE 1 — --teach
// ─────────────────────────────────────────────────────────────────────────────

async function runTeachMode(filePath, vendorHint) {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════╗`);
    console.log(`║      TEACHER AGENT — TEACH MODE  ║`);
    console.log(`╚══════════════════════════════════╝${C.reset}\n`);

    if (!fs.existsSync(filePath)) {
        console.error(`${C.red}✗ File not found: ${filePath}${C.reset}`);
        process.exit(1);
    }

    const buffer   = fs.readFileSync(filePath);
    const ext      = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf'
                   : ext === '.png' ? 'image/png' : 'image/jpeg';

    console.log(`${C.grey}📄 File: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)${C.reset}`);
    console.log(`${C.grey}🤖 Running AI extraction...${C.reset}\n`);

    // Dynamic require to avoid circular dep — document_ai_service requires teacher_agent for few-shot
    const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
    let extracted;
    try {
        extracted = await processInvoiceWithDocAI(buffer, mimeType);
    } catch (err) {
        console.error(`${C.red}✗ Extraction failed: ${err.message}${C.reset}`);
        process.exit(1);
    }

    if (!extracted || extracted.length === 0) {
        console.log(`${C.yellow}⚠  AI returned empty result (JUNK document?)${C.reset}`);
        process.exit(0);
    }

    const inv = extracted[0];

    // ── Print current extraction ──────────────────────────────────────────────
    console.log(`${C.bold}${C.yellow}═══ AI EXTRACTION RESULT ═══${C.reset}`);
    console.log(JSON.stringify(inv, null, 2));
    console.log('');

    // ── Interactive correction session ────────────────────────────────────────
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    console.log(`${C.bold}Now correct any wrong fields. Press ENTER to keep the current value.${C.reset}`);
    console.log(`${C.grey}(Type the corrected value, or just press ENTER to accept as-is)${C.reset}\n`);

    const EDITABLE_FIELDS = [
        'invoiceId', 'vendorName', 'supplierRegistration', 'supplierVat',
        'amount', 'subtotalAmount', 'taxAmount', 'currency',
        'dateCreated', 'dueDate', 'status', 'description'
    ];

    const corrected = { ...inv };

    for (const field of EDITABLE_FIELDS) {
        const current = corrected[field];
        if (current === undefined) continue;
        const input = await ask(
            `  ${C.cyan}${field}${C.reset} [${C.yellow}${current}${C.reset}]: `
        );
        if (input.trim() !== '') {
            // Convert numeric fields
            if (['amount', 'subtotalAmount', 'taxAmount'].includes(field)) {
                const num = parseFloat(input.replace(',', '.'));
                corrected[field] = isNaN(num) ? input.trim() : num;
            } else {
                corrected[field] = input.trim();
            }
            console.log(`    ${C.green}✓ Updated: ${field} = ${corrected[field]}${C.reset}`);
        }
    }

    // ── Gather metadata ───────────────────────────────────────────────────────
    console.log(`\n${C.bold}Metadata for this example:${C.reset}`);

    const defaultVendor = vendorHint || corrected.vendorName || '';
    const vendorInput = await ask(`  Vendor name [${defaultVendor}]: `);
    const finalVendor = vendorInput.trim() || defaultVendor;

    const docDesc = await ask(`  Document structure description (optional, helps AI): `);
    const notes   = await ask(`  Teaching notes — key rules for this vendor (optional): `);

    rl.close();

    // ── Upload PDF to Firebase Storage ────────────────────────────────────────
    let pdfStoragePath = null;
    if (bucket) {
        try {
            const destPath = `invoice_examples/${finalVendor.replace(/[^a-z0-9]/gi, '_')}/${path.basename(filePath)}`;
            await bucket.upload(filePath, {
                destination: destPath,
                metadata: { contentType: mimeType }
            });
            pdfStoragePath = `gs://${bucket.name}/${destPath}`;
            console.log(`\n${C.green}☁  PDF uploaded to: ${pdfStoragePath}${C.reset}`);
        } catch (uploadErr) {
            console.warn(`${C.yellow}⚠  PDF upload failed (non-fatal): ${uploadErr.message}${C.reset}`);
        }
    }

    // ── Build & save example ──────────────────────────────────────────────────
    const example = {
        vendorName:          finalVendor,
        vendorType:          guessVendorType(finalVendor),
        vendorPatterns:      [finalVendor.toLowerCase(), ...extractPatterns(finalVendor)],
        documentDescription: docDesc.trim() || null,
        groundTruth:         corrected,
        teachingNotes:       notes.trim() || null,
        pdfStoragePath,
    };

    console.log(`\n${C.grey}Saving to Firestore collection '${COLLECTION}'...${C.reset}`);
    const savedKey = await saveExample(example);
    console.log(`${C.bold}${C.green}✅ Example saved! Document ID: ${savedKey}${C.reset}\n`);
}

function guessVendorType(vendorName) {
    const n = vendorName.toLowerCase();
    if (/nunner|dsv|girteka|linava|dhl|fedex|ups|tnt/i.test(n)) return 'logistics_LT';
    if (/kindlustus|insurance|if |seesam|gjensidige|lhv kind/i.test(n)) return 'insurance_EE';
    if (/pank|bank|finance|lhv(?! kind)/i.test(n)) return 'bank_EE';
    if (/rent|üür|arrend|kinnisvara/i.test(n)) return 'rental_EE';
    return 'generic';
}

function extractPatterns(vendorName) {
    // Returns shorter versions of the vendor name for fuzzy matching
    const words = vendorName.toLowerCase().split(/\s+/);
    // Remove company suffixes
    const filtered = words.filter(w => !/(oü|as|uab|sia|llc|gmbh|inc|bv|sp\.z\.o\.o\.)/.test(w));
    const patterns = [];
    if (filtered.length > 0) patterns.push(filtered[0]); // first word
    if (filtered.length > 1) patterns.push(filtered.slice(0, 2).join(' ')); // first two words
    return [...new Set(patterns)];
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODE 2 — --eval
// ─────────────────────────────────────────────────────────────────────────────

async function runEvalMode(vendorFilter) {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════╗`);
    console.log(`║      TEACHER AGENT — EVAL MODE   ║`);
    console.log(`╚══════════════════════════════════╝${C.reset}\n`);

    const examples = await loadExamples(vendorFilter);
    if (examples.length === 0) {
        console.log(`${C.yellow}No examples found${vendorFilter ? ` for vendor "${vendorFilter}"` : ''}.${C.reset}`);
        console.log(`Run with --teach to add examples first.\n`);
        process.exit(0);
    }

    console.log(`${C.grey}Found ${examples.length} example(s)${vendorFilter ? ` matching "${vendorFilter}"` : ''}.${C.reset}\n`);

    const COMPARE_FIELDS = [
        'invoiceId', 'vendorName', 'supplierRegistration', 'supplierVat',
        'amount', 'subtotalAmount', 'taxAmount', 'currency',
        'dateCreated', 'dueDate', 'status', 'description'
    ];

    let totalFields  = 0;
    let correctFields = 0;
    const perVendorStats = {};
    const failures = [];

    const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

    for (const example of examples) {
        console.log(`${C.bold}─── Evaluating: ${example.vendorName} (${example.id}) ───${C.reset}`);

        // Download PDF from Storage if available
        let buffer = null;
        if (example.pdfStoragePath && bucket) {
            try {
                const gsPath = example.pdfStoragePath.replace(`gs://${bucket.name}/`, '');
                const [fileBuffer] = await bucket.file(gsPath).download();
                buffer = fileBuffer;
                console.log(`  ${C.grey}Downloaded PDF from Storage.${C.reset}`);
            } catch (dlErr) {
                console.warn(`  ${C.yellow}⚠  Could not download PDF: ${dlErr.message}${C.reset}`);
            }
        }

        if (!buffer) {
            console.log(`  ${C.yellow}⚠  No PDF available for this example — skipping extraction, comparing stored truth only.${C.reset}`);
            // Cannot re-run extraction without the PDF — skip
            continue;
        }

        let extracted;
        try {
            extracted = await processInvoiceWithDocAI(buffer, 'application/pdf');
        } catch (err) {
            console.log(`  ${C.red}✗ Extraction error: ${err.message}${C.reset}`);
            failures.push({ id: example.id, error: err.message });
            continue;
        }

        if (!extracted || extracted.length === 0) {
            console.log(`  ${C.red}✗ AI returned empty — extraction completely failed.${C.reset}`);
            failures.push({ id: example.id, error: 'empty result' });
            continue;
        }

        const ai  = extracted[0];
        const gt  = example.groundTruth;
        const vendorKey = example.vendorName;

        if (!perVendorStats[vendorKey]) {
            perVendorStats[vendorKey] = { correct: 0, total: 0, wrongFields: [] };
        }

        for (const field of COMPARE_FIELDS) {
            if (gt[field] === undefined) continue;
            totalFields++;
            perVendorStats[vendorKey].total++;

            const gtVal = String(gt[field] || '').trim().toLowerCase();
            const aiVal = String(ai[field] || '').trim().toLowerCase();
            const isCorrect = gtVal === aiVal;

            if (isCorrect) {
                correctFields++;
                perVendorStats[vendorKey].correct++;
                console.log(`  ${C.green}✓${C.reset} ${field.padEnd(25)} ${C.grey}${gt[field]}${C.reset}`);
            } else {
                perVendorStats[vendorKey].wrongFields.push(field);
                console.log(`  ${C.red}✗${C.reset} ${field.padEnd(25)} expected: ${C.green}${gt[field]}${C.reset} | got: ${C.red}${ai[field]}${C.reset}`);
            }
        }
        console.log('');
    }

    // ── Summary report ────────────────────────────────────────────────────────
    console.log(`${C.bold}═══════════════════════════════════════`);
    console.log(`            EVAL SUMMARY               `);
    console.log(`═══════════════════════════════════════${C.reset}\n`);

    const overallPct = totalFields > 0 ? ((correctFields / totalFields) * 100).toFixed(1) : 'N/A';
    const scoreColor = parseFloat(overallPct) >= 90 ? C.green
                     : parseFloat(overallPct) >= 70 ? C.yellow : C.red;
    console.log(`  Overall accuracy: ${scoreColor}${C.bold}${overallPct}%${C.reset} (${correctFields}/${totalFields} fields correct)\n`);

    Object.entries(perVendorStats).forEach(([vendor, stats]) => {
        const pct = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : '—';
        const col = parseFloat(pct) >= 90 ? C.green : parseFloat(pct) >= 70 ? C.yellow : C.red;
        console.log(`  ${vendor.padEnd(35)} ${col}${pct}%${C.reset}`);
        if (stats.wrongFields.length > 0) {
            console.log(`    ${C.grey}Wrong fields: ${stats.wrongFields.join(', ')}${C.reset}`);
        }
    });

    if (failures.length > 0) {
        console.log(`\n  ${C.red}Extraction failures (${failures.length}):${C.reset}`);
        failures.forEach(f => console.log(`    ${f.id}: ${f.error}`));
    }

    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const args   = process.argv.slice(2);
    const mode   = args[0];

    if (mode === '--teach') {
        const filePath   = args[1];
        const vendorIdx  = args.indexOf('--vendor');
        const vendorHint = vendorIdx >= 0 ? args[vendorIdx + 1] : null;

        if (!filePath) {
            console.error(`${C.red}Usage: node teacher_agent.cjs --teach <file.pdf> [--vendor "Vendor Name"]${C.reset}`);
            process.exit(1);
        }
        await runTeachMode(filePath, vendorHint);

    } else if (mode === '--eval') {
        const vendorIdx  = args.indexOf('--vendor');
        const vendorHint = vendorIdx >= 0 ? args[vendorIdx + 1] : null;
        await runEvalMode(vendorHint);

    } else {
        console.log(`
${C.bold}Teacher Agent — Invoice Extraction Trainer${C.reset}

${C.cyan}Modes:${C.reset}
  ${C.bold}--teach <file.pdf>${C.reset} [--vendor "Name"]
      Run AI extraction, let you correct wrong fields,
      save as verified ground truth for future training.

  ${C.bold}--eval${C.reset} [--vendor "Name"]
      Re-run extraction on all stored examples,
      compare against ground truth, print accuracy report.

${C.cyan}Examples:${C.reset}
  node teacher_agent.cjs --teach ./nunner_invoice.pdf --vendor "NUNNER Logistics UAB"
  node teacher_agent.cjs --teach ./lhv_bill.pdf
  node teacher_agent.cjs --eval
  node teacher_agent.cjs --eval --vendor NUNNER
`);
        process.exit(0);
    }

    process.exit(0);
}

// Run only when called directly (not when required as a library)
if (require.main === module) {
    main().catch(err => {
        console.error(`${C.red}Fatal error: ${err.message}${C.reset}`);
        if (process.env.DEBUG) console.error(err);
        process.exit(1);
    });
}

// Exports: pipeline function + few-shot helper + example management
module.exports = { validateAndTeach, getFewShotExamples, loadExamples, saveExample, findExamplesByIdentifiers };
