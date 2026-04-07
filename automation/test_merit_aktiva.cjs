// test_merit_aktiva.cjs — тест Merit Aktiva API (dry-run, без сохранения)
// Запуск: node automation/test_merit_aktiva.cjs

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.pipeline') });

const { fetchBankStatements, parseEuropeanNumber } = require('./merit_aktiva_agent.cjs');

// Последние 7 дней
function dateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

async function runTest() {
    const endDate   = dateStr(0);
    const startDate = dateStr(-7);

    console.log(`\n=== Merit Aktiva API Test ===`);
    console.log(`Period: ${startDate} → ${endDate}`);
    console.log(`ApiId:  ${process.env.MERIT_AKTIVA_USERNAME || '(not set)'}`);
    console.log(`ApiKey: ${process.env.MERIT_AKTIVA_PASSWORD ? '***' : '(not set)'}`);
    console.log('');

    if (!process.env.MERIT_AKTIVA_USERNAME || !process.env.MERIT_AKTIVA_PASSWORD) {
        console.error('ERROR: MERIT_AKTIVA_USERNAME / MERIT_AKTIVA_PASSWORD not set in .env.pipeline');
        console.error('Add these lines to .env.pipeline:');
        console.error('  MERIT_AKTIVA_USERNAME=your_api_id');
        console.error('  MERIT_AKTIVA_PASSWORD=your_api_key');
        process.exit(1);
    }

    let transactions;
    try {
        transactions = await fetchBankStatements(startDate, endDate);
    } catch (err) {
        console.error('FAIL:', err.message);
        process.exit(1);
    }

    console.log(`Records received: ${transactions.length}`);
    if (transactions.length === 0) {
        console.warn('No transactions in last 7 days — try a wider range or check credentials');
        process.exit(0);
    }

    // Validation checks
    let ok = true;

    // 1. Check date format
    const badDates = transactions.filter(t => !/^\d{4}-\d{2}-\d{2}$/.test(t.date));
    if (badDates.length) {
        console.error(`FAIL: ${badDates.length} transactions have bad date format:`);
        badDates.slice(0, 3).forEach(t => console.error(`  index=${t.index} date="${t.date}"`));
        ok = false;
    } else {
        console.log(`OK: all dates in ISO format (YYYY-MM-DD)`);
    }

    // 2. Check amounts parsed correctly
    const zeroAmounts = transactions.filter(t => t.amount === 0);
    if (zeroAmounts.length > 0) {
        console.warn(`WARN: ${zeroAmounts.length} transactions have amount=0 (check raw data)`);
    } else {
        console.log(`OK: all amounts non-zero`);
    }

    // 3. Check currency
    const currencies = [...new Set(transactions.map(t => t.currency))];
    console.log(`OK: currencies found: ${currencies.join(', ')}`);

    // 4. European number parsing test
    const testCases = [
        ['1.234,56', 1234.56],
        ['1,234.56', 1234.56],
        ['1234.56',  1234.56],
        ['1234,56',  1234.56],
        ['-500,00', -500.00],
    ];
    let parseOk = true;
    for (const [input, expected] of testCases) {
        const result = parseEuropeanNumber(input);
        if (Math.abs(result - expected) > 0.001) {
            console.error(`FAIL parseEuropeanNumber("${input}") = ${result}, expected ${expected}`);
            parseOk = false;
        }
    }
    if (parseOk) console.log('OK: European number format parsing correct');

    // Print sample transactions
    console.log('\n--- Sample transactions (first 5) ---');
    transactions.slice(0, 5).forEach((t, i) => {
        console.log(`[${i+1}] ${t.date}  ${t.currency} ${t.amount.toFixed(2).padStart(10)}  "${t.description.slice(0, 50)}"`);
    });

    console.log(`\n${ok ? '✓ TEST PASSED' : '✗ TEST FAILED'}`);
    process.exit(ok ? 0 : 1);
}

runTest().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
