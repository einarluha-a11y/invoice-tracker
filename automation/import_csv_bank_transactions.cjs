#!/usr/bin/env node
/**
 * Import bank transactions directly from local CSV files into Firestore.
 *
 * Usage:
 *   node import_csv_bank_transactions.cjs              # dry-run
 *   node import_csv_bank_transactions.cjs --save       # save to Firestore
 */

// Use node_modules from main repo
const mainAutomation = '/Users/einarluha/Downloads/invoice-tracker/automation';
require(mainAutomation + '/node_modules/dotenv').config({ path: mainAutomation + '/.env' });
const fs = require('fs');
const { parse } = require(mainAutomation + '/node_modules/csv-parse/sync');
const { admin, db } = require(mainAutomation + '/core/firebase.cjs');
const { cleanNum } = require(mainAutomation + '/core/utils.cjs');

const SAVE = process.argv.includes('--save');
const COMPANY_ID = 'vlhvA6i8d3Hry8rtrA3Z'; // Ideacom OÜ

const CSV_FILES = [
    '/Users/einarluha/Downloads/transaction-statement_16-Jul-2025_31-Jul-2025.csv',
    '/Users/einarluha/Downloads/transaction-statement_01-Aug-2025_31-Aug-2025.csv',
    '/Users/einarluha/Downloads/transaction-statement_01-Sep-2025_30-Sep-2025.csv',
    '/Users/einarluha/Downloads/transaction-statement_01-Oct-2025_31-Oct-2025.csv',
];

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('IMPORT: CSV files → bank_transactions');
    console.log(SAVE ? '🔥 LIVE MODE — saving to Firestore' : '👁️  DRY RUN — pass --save to write');
    console.log('═══════════════════════════════════════════════════\n');

    // Load existing transactions for deduplication
    const existingSnap = await db.collection('bank_transactions')
        .where('companyId', '==', COMPANY_ID).get();
    const existingKeys = new Set();
    for (const doc of existingSnap.docs) {
        const d = doc.data();
        existingKeys.add(`${d.date}|${d.amount}|${d.counterparty}|${d.reference}`);
    }
    console.log(`ℹ️  ${existingSnap.size} existing transactions for this company.\n`);

    const seenTx = new Set();
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalDupes = 0;

    for (const filePath of CSV_FILES) {
        const filename = filePath.split('/').pop();
        console.log(`─── ${filename} ───`);

        if (!fs.existsSync(filePath)) {
            console.log(`  ⚠️  File not found — skipping`);
            totalSkipped++;
            continue;
        }

        const rawText = fs.readFileSync(filePath, 'utf-8');
        let records;
        try {
            records = parse(rawText, {
                columns: true,
                skip_empty_lines: true,
                relax_column_count: true,
            });
        } catch (e) {
            console.log(`  ⚠️  CSV parse failed: ${e.message}`);
            totalSkipped++;
            continue;
        }

        console.log(`  Parsed ${records.length} rows.`);
        let fileSaved = 0;

        for (const row of records) {
            let amountStr = row['Amount'] || row['Total amount'] || '';
            const isNegative = String(amountStr).trim().startsWith('-');
            let amount = cleanNum(amountStr);
            if (isNegative) amount = -Math.abs(amount);
            if (!amount || amount >= 0) continue; // Only outgoing

            const rawAmount = Math.abs(amount);

            // Fee
            let feeStr = row['Fee'] || row['Bank Fee'] || '0';
            const bankFee = Math.abs(cleanNum(feeStr));

            // Invoice target vs total drain
            let invoiceTargetAmount = rawAmount;
            let totalBankDrain = rawAmount;

            const explicitTargetStr = row['Amount'] || '';
            const explicitTarget = Math.abs(cleanNum(explicitTargetStr));

            if (explicitTarget > 0 && explicitTarget !== rawAmount) {
                invoiceTargetAmount = explicitTarget;
                totalBankDrain = Math.max(invoiceTargetAmount + bankFee, rawAmount);
            } else if (bankFee > 0 && rawAmount > bankFee) {
                invoiceTargetAmount = rawAmount - bankFee;
            }

            const reference = (row['Reference'] || '').trim();
            const dateStr = (row['Date started (UTC)'] || row['Completed Date'] || row['Date'] || '').trim();
            let description = (row['Description'] || row['Payer'] || '').trim();
            description = description.replace(/^(получатель|оплата|зачисление|перевод):\s*/i, '');

            // Foreign currency
            let origAmountStr = row['Orig amount'] || row['Original amount'] || row['Original Amount'] || row['Target amount'] || '';
            const foreignAmountNum = cleanNum(origAmountStr);
            const foreignAmount = foreignAmountNum ? Math.abs(foreignAmountNum) : null;
            const foreignCurrency = (row['Orig currency'] || row['Original Currency'] || row['Target currency'] || '').trim() || null;

            // Deduplicate within this run
            const txKey = `${dateStr}|${invoiceTargetAmount}|${description}|${reference}`;
            if (seenTx.has(txKey)) { totalDupes++; continue; }
            seenTx.add(txKey);

            // Deduplicate against Firestore
            const existKey = `${dateStr}|${invoiceTargetAmount}|${description}|${reference}`;
            if (existingKeys.has(existKey)) { totalDupes++; continue; }

            const txData = {
                companyId: COMPANY_ID,
                date: dateStr || null,
                amount: invoiceTargetAmount,
                totalBankDrain,
                bankFee,
                reference,
                counterparty: description,
                foreignAmount: foreignAmount || null,
                foreignCurrency: foreignCurrency === 'EUR' ? null : foreignCurrency,
                source: 'csv_import',
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (SAVE) {
                await db.collection('bank_transactions').add(txData);
            } else {
                console.log(`    ${dateStr} | ${invoiceTargetAmount.toFixed(2)} EUR | ${description.substring(0, 40)} | ref: ${reference}`);
            }

            fileSaved++;
            totalSaved++;
        }

        console.log(`  ✅ ${fileSaved} outgoing transactions ${SAVE ? 'saved' : 'found'}`);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`Total: ${totalSaved} new transactions ${SAVE ? 'saved' : 'would be saved'}, ${totalDupes} duplicates skipped, ${totalSkipped} files skipped`);
    if (!SAVE && totalSaved > 0) {
        console.log('Run with --save to write to Firestore.');
    }
    console.log('═══════════════════════════════════════════════════');

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
