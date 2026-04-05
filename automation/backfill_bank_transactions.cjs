#!/usr/bin/env node
/**
 * Backfill bank_transactions collection from raw_documents archive.
 *
 * Reads all bank statements (CSV) stored in raw_documents,
 * parses their rawText, and saves each transaction row to bank_transactions.
 *
 * Safe to run multiple times — checks for existing transactions before saving.
 * Does NOT re-reconcile invoices (no status changes).
 *
 * Usage:
 *   node backfill_bank_transactions.cjs              # dry-run
 *   node backfill_bank_transactions.cjs --save        # save to Firestore
 */

require('dotenv').config({ path: __dirname + '/.env' });
const { parse } = require('csv-parse/sync');
const { admin, db } = require('./core/firebase.cjs');
const { saveBankTransaction } = require('./core/bank_dedup.cjs');

const SAVE = process.argv.includes('--save');

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('BACKFILL: bank_transactions from raw_documents');
    console.log(SAVE ? '🔥 LIVE MODE — saving to Firestore' : '👁️  DRY RUN — pass --save to write');
    console.log('═══════════════════════════════════════════════════\n');

    // 1. Check how many bank_transactions already exist
    const existingSnap = await db.collection('bank_transactions').limit(1).get();
    if (!existingSnap.empty) {
        const countSnap = await db.collection('bank_transactions').get();
        console.log(`ℹ️  bank_transactions already has ${countSnap.size} records.\n`);
    }

    // 2. Get all bank statement raw_documents
    const rawSnap = await db.collection('raw_documents')
        .where('type', 'in', ['bank_statement', 'bank_statement_csv'])
        .get();

    console.log(`Found ${rawSnap.size} bank statement(s) in raw_documents.\n`);

    if (rawSnap.empty) {
        console.log('Nothing to backfill.');
        process.exit(0);
    }

    // Deduplicate: track unique transactions by key
    const seenTx = new Set();
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalDupes = 0;

    for (const doc of rawSnap.docs) {
        const data = doc.data();
        const rawText = data.rawText || '';
        const companyId = data.companyId || null;
        const source = data.source || {};
        const filename = source.filename || 'unknown';

        console.log(`─── ${filename} (${companyId || 'no company'}) ───`);

        if (!rawText || rawText.trim().length < 20) {
            console.log(`  ⚠️  No rawText — skipping (may be PDF without text extraction)`);
            totalSkipped++;
            continue;
        }

        // Try to parse as CSV
        let records;
        try {
            records = parse(rawText, {
                columns: true,
                skip_empty_lines: true,
                relax_column_count: true,
            });
        } catch (parseErr) {
            console.log(`  ⚠️  CSV parse failed: ${parseErr.message}`);
            totalSkipped++;
            continue;
        }

        if (records.length === 0) {
            console.log(`  ⚠️  No rows parsed`);
            totalSkipped++;
            continue;
        }

        console.log(`  Parsed ${records.length} rows. Processing outgoing payments...`);

        let statementSaved = 0;

        for (const row of records) {
            let amountStr = row['Amount'] || row['Total amount'] || '';
            let amount = parseFloat(amountStr.replace(/,/g, ''));
            if (isNaN(amount) || amount >= 0) continue; // Only outgoing

            const rawAmount = Math.abs(amount);

            // Fee
            let feeStr = row['Fee'] || row['Bank Fee'] || row['Комиссия'] || row['Teenustasu'] || '0';
            const bankFee = Math.abs(parseFloat(feeStr.replace(/,/g, ''))) || 0;

            // Invoice target vs total drain
            let invoiceTargetAmount = rawAmount;
            let totalBankDrain = rawAmount;

            const explicitTargetStr = row['Amount'] || '';
            const explicitTarget = Math.abs(parseFloat(explicitTargetStr.replace(/,/g, ''))) || 0;

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
            let origAmountStr = row['Original amount'] || row['Original Amount'] || row['Target amount'] || '';
            let foreignAmountNum = parseFloat(origAmountStr.replace(/[^0-9.]/g, ''));
            const foreignAmount = isNaN(foreignAmountNum) ? null : Math.abs(foreignAmountNum);
            const foreignCurrency = (row['Original Currency'] || row['original currency'] || row['Target currency'] || '').trim();

            const txData = {
                companyId,
                date: dateStr || null,
                amount: invoiceTargetAmount,
                totalBankDrain,
                bankFee,
                reference,
                counterparty: description,
                foreignAmount: foreignAmount || null,
                foreignCurrency: foreignCurrency || null,
                source: 'backfill',
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (SAVE) {
                // saveBankTransaction uses deterministic ID — Firestore rejects duplicates atomically
                const result = await saveBankTransaction(db, txData);
                if (result.duplicate) {
                    totalDupes++;
                    continue;
                }
            } else {
                // Dry-run: still use in-memory Set to report expected dedup count
                const txKey = `${companyId}|${dateStr}|${invoiceTargetAmount}|${description}|${reference}`;
                if (seenTx.has(txKey)) { totalDupes++; continue; }
                seenTx.add(txKey);
            }

            statementSaved++;
            totalSaved++;
        }

        console.log(`  ✅ ${statementSaved} outgoing transactions ${SAVE ? 'saved' : 'found'}`);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`Total: ${totalSaved} unique transactions ${SAVE ? 'saved' : 'would be saved'}, ${totalDupes} duplicates skipped, ${totalSkipped} statements skipped`);
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
