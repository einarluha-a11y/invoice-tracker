#!/usr/bin/env node
/**
 * Миграция данных для мультипользовательского режима.
 * Добавляет поле accountId в invoices и bank_transactions.
 *
 * Запуск:
 *   node migrate_to_accounts.cjs --dry-run   (только показывает что будет)
 *   node migrate_to_accounts.cjs --save       (реально меняет)
 */

const { db } = require('./core/firebase.cjs');

const DRY_RUN = !process.argv.includes('--save');

// Маппинг companyId → accountId
const COMPANY_TO_ACCOUNT = {
    'bP6dc0PMdFtnmS5QTX4N': 'global-technics',  // Global Technics OÜ
    'vlhvA6i8d3Hry8rtrA3Z': 'ideacom',           // Ideacom OÜ
};

async function migrateCollection(collectionName, companyField) {
    const snap = await db.collection(collectionName).get();
    let updated = 0;
    let skipped = 0;
    let unknown = 0;

    const batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH = 400;
    const batches = [db.batch()];
    let currentBatchIdx = 0;
    let currentBatchCount = 0;

    for (const doc of snap.docs) {
        const data = doc.data();

        // Уже мигрирован — пропускаем
        if (data.accountId) {
            skipped++;
            continue;
        }

        const companyId = data[companyField];
        const accountId = COMPANY_TO_ACCOUNT[companyId];

        if (!accountId) {
            unknown++;
            if (DRY_RUN) {
                console.log(`  [?] ${collectionName}/${doc.id} — неизвестная компания: ${companyId}`);
            }
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [+] ${collectionName}/${doc.id} → accountId="${accountId}"`);
        } else {
            if (currentBatchCount >= MAX_BATCH) {
                batches.push(db.batch());
                currentBatchIdx++;
                currentBatchCount = 0;
            }
            batches[currentBatchIdx].update(doc.ref, { accountId });
            currentBatchCount++;
        }
        updated++;
    }

    if (!DRY_RUN && updated > 0) {
        for (const b of batches) {
            await b.commit();
        }
    }

    console.log(`  ${collectionName}: обновить ${updated}, пропустить ${skipped} (уже есть accountId), неизвестных компаний ${unknown}`);
    return { updated, skipped, unknown };
}

async function main() {
    console.log(DRY_RUN ? '=== DRY-RUN (без изменений) ===' : '=== SAVE (пишем в Firestore) ===');

    console.log('\n[invoices]');
    const inv = await migrateCollection('invoices', 'companyId');

    console.log('\n[bank_transactions]');
    const bt = await migrateCollection('bank_transactions', 'companyId');

    const totalUpdated = inv.updated + bt.updated;
    console.log(`\nИтого: ${totalUpdated} документов ${DRY_RUN ? 'будет обновлено' : 'обновлено'}.`);

    if (DRY_RUN && totalUpdated > 0) {
        console.log('\nЗапустите с --save чтобы применить изменения.');
    }

    process.exit(0);
}

main().catch(e => {
    console.error('❌ Ошибка:', e.message);
    process.exit(1);
});
