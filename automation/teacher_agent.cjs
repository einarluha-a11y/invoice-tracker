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

        // Match by VAT number
        if (invoiceVat.length > 5) {
            const exVat = (gt.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (exVat.length > 5 && exVat === invoiceVat) {
                matches.push(ex);
                continue;
            }
        }

        // Match by registration code
        if (invoiceReg.length > 4) {
            const exReg = (gt.supplierRegistration || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
            if (exReg.length > 4 && exReg === invoiceReg) {
                matches.push(ex);
                continue;
            }
        }

        // Match by vendorPatterns (saved from manual edits on dashboard)
        if (ex.vendorPatterns && Array.isArray(ex.vendorPatterns) && !isEmpty(invoice.vendorName)) {
            const invName = invoice.vendorName.toLowerCase();
            for (const pattern of ex.vendorPatterns) {
                if (pattern && invName.includes(pattern.toLowerCase())) {
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

    // ── 1. Parallel load: Charter + Global Rules + Examples ────────────────
    // All three are independent Firestore reads — run in parallel to save ~300ms
    const vatPrefix = (invoice.supplierVat || '').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();

    const [charterResult, globalRulesResult, examplesResult] = await Promise.all([
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
    ]);

    // ── 1a. Extract Charter rules ───────────────────────────────────────────
    let charterRules = '';
    if (charterResult && charterResult.exists) {
        charterRules = charterResult.data().customAiRules || '';
    }

    // ── 1b. Apply global rules ──────────────────────────────────────────────
    const [currencyRuleDoc, termsSnap, taxRuleDoc] = globalRulesResult;

    // VAT country → currency
    if (currencyRuleDoc && currencyRuleDoc.exists) {
        const rule = currencyRuleDoc.data();
        if (rule.count >= 2 && rule.value && invoice.currency !== rule.value) {
            corrections.push(`Global rule: VAT ${vatPrefix} → currency ${invoice.currency} → ${rule.value} (${rule.count} edits)`);
            invoice.currency = rule.value;
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
        const STATIC_FIELDS = ['supplierVat', 'supplierRegistration', 'currency'];
        for (const field of STATIC_FIELDS) {
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

    // ── 4. Apply Charter rules ──────────────────────────────────────────────
    if (charterRules) {
        const rulesApplied = applyCharterRules(invoice, charterRules);
        corrections.push(...rulesApplied);
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
                }
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
function applyCharterRules(invoice, rulesText) {
    const applied = [];
    const rules = rulesText.split('\n').filter(r => r.trim());

    // Helper: check if this rule's vendor matches the current invoice
    function vendorMatch(ruleVendor) {
        if (!invoice.vendorName) return false;
        return invoice.vendorName.toLowerCase().includes(ruleVendor.toLowerCase());
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

        // Due date rule: Vendor "X": net-30
        const dueDateMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*net-?(\d+)/i);
        if (dueDateMatch) {
            const [, vendor, days] = dueDateMatch;
            if (vendorMatch(vendor) && invoice.dateCreated) {
                // Apply if dueDate is empty OR equals dateCreated (= not parsed correctly)
                const dueDateSuspicious = !invoice.dueDate || isEmpty(invoice.dueDate) || invoice.dueDate === invoice.dateCreated;
                if (dueDateSuspicious) {
                    const d = new Date(invoice.dateCreated);
                    d.setDate(d.getDate() + parseInt(days));
                    invoice.dueDate = d.toISOString().split('T')[0];
                    applied.push(`Charter: set dueDate = dateCreated + ${days} days for "${vendor}"`);
                }
            }
            continue;
        }

        // Currency rule: Vendor "X": currency = "EUR"
        const currMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*currency\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (currMatch) {
            const [, vendor, curr] = currMatch;
            if (vendorMatch(vendor) && invoice.currency !== curr) {
                applied.push(`Charter: corrected currency ${invoice.currency} → ${curr} for "${vendor}"`);
                invoice.currency = curr;
            }
            continue;
        }

        // Default description: Vendor "X": description = "Y"
        const descMatch = rule.match(/[Vv]endor\s*[""\u201c\u201d](.+?)[""\u201c\u201d]:\s*description\s*=\s*[""\u201c\u201d](.+?)[""\u201c\u201d]/i);
        if (descMatch) {
            const [, vendor, desc] = descMatch;
            if (vendorMatch(vendor) && isEmpty(invoice.description)) {
                invoice.description = desc;
                applied.push(`Charter: set description = "${desc}" for "${vendor}"`);
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
