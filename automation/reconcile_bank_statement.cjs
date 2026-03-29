/**
 * reconcile_bank_statement.cjs
 * 
 * Manually reconciles a parsed bank statement against Firestore invoices.
 * Matches by: amount (±€0.50 tolerance) + vendor name similarity OR invoice reference.
 * 
 * Usage:
 *   node reconcile_bank_statement.cjs              — dry-run, shows matches
 *   node reconcile_bank_statement.cjs --fix        — mark matched invoices as Paid
 *   node reconcile_bank_statement.cjs --company <id> --fix
 */
require('dotenv').config({ path: '../.env' });
const { admin, db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--fix');
const TARGET_COMPANY = (() => {
    const idx = process.argv.indexOf('--company');
    return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ─── PASTE BANK STATEMENT TRANSACTIONS HERE ──────────────────────────────────
// Format: { vendor, amount, reference }
// Parsed from: Revolut Business statement 26-29 Mar 2026, Global Technics OÜ
const BANK_TRANSACTIONS = [
    { vendor: 'Etra Balti AS',                      amount: 49.30,     reference: '4104312' },
    { vendor: 'ATRIGON B.V.',                        amount: 1000.00,   reference: '169' },
    { vendor: 'Stén & Co OÜ',                        amount: 382.41,    reference: '1033270' },
    { vendor: 'Tele2 Eesti Aktsiaselts',             amount: 88.50,     reference: '15124857692 855028033' },
    { vendor: 'ZONE MEDIA OÜ',                       amount: 44.65,     reference: '1010134359 1270088' },
    { vendor: 'Allstore Assets OÜ',                  amount: 110.56,    reference: 'B04091' },
    { vendor: 'UAB Konica Minolta Baltia Eesti filiaal', amount: 25.01, reference: 'EES048338' },
    { vendor: 'Accounting Resources OÜ',             amount: 477.60,    reference: '6426' },
    { vendor: 'SMC AUTOMATION OÜ',                   amount: 131.79,    reference: '2502196' },
    { vendor: 'Allstore Assets OÜ',                  amount: 605.32,    reference: 'B03962' },
    { vendor: 'Allstore Assets OÜ',                  amount: 605.32,    reference: 'B03033 09276' },
    { vendor: 'Täisteenusliisingu AS',               amount: 127.81,    reference: '5102974000220260318 51029740002' },
    { vendor: 'Täisteenusliisingu AS',               amount: 91.81,     reference: '5103460000120260318 51034600001' },
    { vendor: 'SMC AUTOMATION OÜ',                   amount: 233.39,    reference: '2501851' },
    { vendor: 'Web Design Agency OÜ',                amount: 434.00,    reference: '253362 2533627' },
    { vendor: 'SMC AUTOMATION OÜ',                   amount: 1102.75,   reference: '2501599' },
    { vendor: 'NUIA PMT AS',                         amount: 5614.53,   reference: '19733' },
    { vendor: 'DMYTRO SUPRUN',                       amount: 3000.00,   reference: '20/03/2026' },
    { vendor: 'Terma sp. z o. o.',                   amount: 28457.00,  reference: 'FE/25/09873' },
    // Anthropic Ireland (€10.88) is a service charge — not an invoice payment, skip
];
// ─────────────────────────────────────────────────────────────────────────────

function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function vendorMatch(invVendor, txVendor) {
    const a = normalize(invVendor);
    const b = normalize(txVendor);
    return a.includes(b) || b.includes(a) || 
           (a.length > 4 && b.length > 4 && (a.includes(b.slice(0,8)) || b.includes(a.slice(0,8))));
}

function referenceMatch(invId, txRef) {
    const ref = normalize(txRef);
    const id  = normalize(invId);
    return id.length > 3 && (ref.includes(id) || id.includes(ref));
}

async function run() {
    console.log(`\n💳 reconcile_bank_statement.cjs — ${DRY_RUN ? 'DRY RUN' : '⚠️  WRITE MODE'}`);
    console.log(`   Revolut Business · Global Technics OÜ · 26-29 Mar 2026\n`);

    // Load all unpaid invoices for the company
    let q = db.collection('invoices')
        .where('status', 'in', ['Pending', 'Unpaid', 'OOTEL', 'NEEDS_REVIEW',
                                  'Needs Action', 'Overdue', 'Duplicate']);
    if (TARGET_COMPANY) {
        // client-side filter — Firestore doesn't support two inequality fields
        console.log(`   Company filter: ${TARGET_COMPANY}\n`);
    }
    const snap = await q.get();
    const invoices = [];
    snap.forEach(doc => {
        const d = doc.data();
        if (!TARGET_COMPANY || d.companyId === TARGET_COMPANY) {
            invoices.push({ id: doc.id, ref: doc.ref, ...d });
        }
    });

    console.log(`Loaded ${invoices.length} unpaid invoices from Firestore.\n`);

    const matched   = [];
    const unmatched = [];

    for (const tx of BANK_TRANSACTIONS) {
        let best = null;

        for (const inv of invoices) {
            const invAmt = Math.abs(parseFloat(inv.amount) || 0);
            const diff   = Math.abs(invAmt - tx.amount);

            if (diff > 0.50) continue;   // amount tolerance ±€0.50

            const nameOk = vendorMatch(inv.vendorName, tx.vendor);
            const refOk  = referenceMatch(inv.invoiceId, tx.reference);

            if (nameOk || refOk) {
                best = { inv, diff, nameOk, refOk };
                break;
            }
        }

        if (best) {
            matched.push({ tx, inv: best.inv, diff: best.diff,
                           nameOk: best.nameOk, refOk: best.refOk });
        } else {
            unmatched.push(tx);
        }
    }

    // ── Report ──
    console.log(`━━━ MATCHED (${matched.length}) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    matched.forEach(({ tx, inv, diff, nameOk, refOk }) => {
        const how = [nameOk && 'vendor', refOk && 'ref'].filter(Boolean).join('+');
        console.log(`  ✅  [${how}] ${tx.vendor.padEnd(38)} €${tx.amount}`);
        console.log(`       → Invoice: "${inv.invoiceId}" €${inv.amount} (diff €${diff.toFixed(2)}) status=${inv.status} company=${inv.companyId}`);
    });

    console.log(`\n━━━ NO MATCH (${unmatched.length}) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    unmatched.forEach(tx => {
        console.log(`  ❌  ${tx.vendor.padEnd(38)} €${tx.amount}  ref=${tx.reference}`);
    });

    if (!DRY_RUN && matched.length > 0) {
        console.log(`\n⏳ Marking ${matched.length} invoices as Paid...`);
        for (const { tx, inv } of matched) {
            await db.runTransaction(async t => {
                const fresh = await t.get(inv.ref);
                if (!fresh.exists || fresh.data().status === 'Paid') return;
                t.update(inv.ref, {
                    status: 'Paid',
                    paidAt: admin.firestore.FieldValue.serverTimestamp(),
                    paidByStatement: `Revolut 26-29 Mar 2026 · ${tx.vendor} · €${tx.amount}`
                });
            });
            console.log(`   ✅  Paid: ${inv.vendorName} — ${inv.invoiceId}`);
        }
        console.log('\n✅  Done! Refresh the dashboard to see the updates.');
    } else if (DRY_RUN) {
        console.log(`\n👆 Run with --fix to mark ${matched.length} invoices as Paid.`);
    }

    process.exit(0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
