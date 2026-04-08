require('dotenv').config({ path: __dirname + '/.env' });
const { db } = require('./core/firebase.cjs');

const REQUIRED_FIELDS = [
  'vendorName', 'invoiceId', 'description', 'amount', 'currency',
  'dateCreated', 'dueDate', 'supplierVat', 'supplierRegistration',
  'subtotalAmount', 'taxAmount'
];
const VALID_STATUSES = new Set(['Draft', 'Pending', 'Paid', 'Overdue', 'Needs Action', 'Duplicate', 'UNREPAIRABLE']);

async function main() {
  console.log('=== DATA AUDIT START ===\n');

  const [invoicesSnap, companiesSnap] = await Promise.all([
    db.collection('invoices').get(),
    db.collection('companies').get()
  ]);

  const companyNames = {};
  companiesSnap.docs.forEach(d => {
    companyNames[d.id] = d.data().name || d.id;
  });

  const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Total invoices: ${invoices.length}\n`);

  const issues = {
    missingFields: [],
    wrongStatus: [],
    duplicates: [],
    zeroPendingAmount: [],
    badDates: [],
  };

  // Duplicate detection: same vendorName + invoiceId + companyId
  const seen = new Map();
  for (const inv of invoices) {
    const key = `${inv.companyId}|${inv.vendorName}|${inv.invoiceId}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(inv.id);
  }
  for (const [key, ids] of seen.entries()) {
    if (ids.length > 1) {
      issues.duplicates.push({ key, ids });
    }
  }

  for (const inv of invoices) {
    const cName = companyNames[inv.companyId] || inv.companyId;

    // Missing required fields
    const missing = REQUIRED_FIELDS.filter(f => {
      const v = inv[f];
      return v === undefined || v === null || v === '';
    });
    if (missing.length > 0) {
      issues.missingFields.push({ id: inv.id, company: cName, vendorName: inv.vendorName, invoiceId: inv.invoiceId, missing });
    }

    // Wrong status
    if (inv.status && !VALID_STATUSES.has(inv.status)) {
      issues.wrongStatus.push({ id: inv.id, company: cName, status: inv.status });
    }

    // Pending with zero or null amount
    if (inv.status === 'Pending' && (inv.amount === 0 || inv.amount === null || inv.amount === undefined)) {
      issues.zeroPendingAmount.push({ id: inv.id, company: cName, vendorName: inv.vendorName, amount: inv.amount });
    }

    // Bad date format
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (inv.dateCreated && !dateRe.test(inv.dateCreated)) {
      issues.badDates.push({ id: inv.id, company: cName, field: 'dateCreated', value: inv.dateCreated });
    }
    if (inv.dueDate && !dateRe.test(inv.dueDate)) {
      issues.badDates.push({ id: inv.id, company: cName, field: 'dueDate', value: inv.dueDate });
    }
  }

  // Report
  console.log('--- 1. MISSING REQUIRED FIELDS ---');
  if (issues.missingFields.length === 0) {
    console.log('✅ Нет проблем\n');
  } else {
    console.log(`❌ Найдено: ${issues.missingFields.length} инвойсов\n`);
    for (const item of issues.missingFields) {
      console.log(`  [${item.id}] ${item.company} | ${item.vendorName || '?'} ${item.invoiceId || '?'}`);
      console.log(`    Отсутствуют: ${item.missing.join(', ')}`);
    }
    console.log();
  }

  console.log('--- 2. НЕВЕРНЫЙ СТАТУС ---');
  if (issues.wrongStatus.length === 0) {
    console.log('✅ Нет проблем\n');
  } else {
    console.log(`❌ Найдено: ${issues.wrongStatus.length}\n`);
    for (const item of issues.wrongStatus) {
      console.log(`  [${item.id}] ${item.company} | status="${item.status}"`);
    }
    console.log();
  }

  console.log('--- 3. ДУБЛИКАТЫ ---');
  if (issues.duplicates.length === 0) {
    console.log('✅ Нет дубликатов\n');
  } else {
    console.log(`❌ Найдено: ${issues.duplicates.length} групп\n`);
    for (const item of issues.duplicates) {
      console.log(`  Key: ${item.key}`);
      console.log(`  IDs: ${item.ids.join(', ')}`);
    }
    console.log();
  }

  console.log('--- 4. PENDING С НУЛЕВОЙ СУММОЙ ---');
  if (issues.zeroPendingAmount.length === 0) {
    console.log('✅ Нет проблем\n');
  } else {
    console.log(`❌ Найдено: ${issues.zeroPendingAmount.length}\n`);
    for (const item of issues.zeroPendingAmount) {
      console.log(`  [${item.id}] ${item.company} | ${item.vendorName} | amount=${item.amount}`);
    }
    console.log();
  }

  console.log('--- 5. НЕВЕРНЫЙ ФОРМАТ ДАТ ---');
  if (issues.badDates.length === 0) {
    console.log('✅ Нет проблем\n');
  } else {
    console.log(`❌ Найдено: ${issues.badDates.length}\n`);
    for (const item of issues.badDates) {
      console.log(`  [${item.id}] ${item.company} | ${item.field}="${item.value}"`);
    }
    console.log();
  }

  const totalIssues = issues.missingFields.length + issues.wrongStatus.length +
    issues.duplicates.length + issues.zeroPendingAmount.length + issues.badDates.length;

  console.log('=== ИТОГ ===');
  console.log(`Всего инвойсов: ${invoices.length}`);
  console.log(`Инвойсов с неполными полями: ${issues.missingFields.length}`);
  console.log(`Неверных статусов: ${issues.wrongStatus.length}`);
  console.log(`Групп дубликатов: ${issues.duplicates.length}`);
  console.log(`Pending с нулём: ${issues.zeroPendingAmount.length}`);
  console.log(`Неверных дат: ${issues.badDates.length}`);
  console.log(`\nИТОГО ПРОБЛЕМ: ${totalIssues}`);

  return { issues, total: invoices.length };
}

main().catch(console.error).finally(() => process.exit(0));
