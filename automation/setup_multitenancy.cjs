#!/usr/bin/env node
/**
 * Фаза 1 мультипользовательского режима.
 * Создаёт структуру accounts/ и master_users/ в Firestore.
 *
 * Запуск:
 *   node setup_multitenancy.cjs
 */

const { admin, db } = require('./core/firebase.cjs');

const EINAR_UID  = 'MI9J2VBriwQ45jEMJ5tmbagfHm93';
const EINAR_EMAIL = 'einar.luha@gmail.com';
const GT_ID      = 'bP6dc0PMdFtnmS5QTX4N';
const IDEACOM_ID = 'vlhvA6i8d3Hry8rtrA3Z';

async function main() {
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ── 1. master_users/{uid} ─────────────────────────────────────────────────
    console.log('\n[1] master_users...');
    const masterRef = db.collection('master_users').doc(EINAR_UID);
    await masterRef.set({ email: EINAR_EMAIL, createdAt: now });
    console.log('    ✅ master_users/' + EINAR_UID);

    // ── 2. Загрузить данные компаний ──────────────────────────────────────────
    console.log('\n[2] Загружаю данные компаний...');
    const [gtSnap, ideacomSnap] = await Promise.all([
        db.collection('companies').doc(GT_ID).get(),
        db.collection('companies').doc(IDEACOM_ID).get(),
    ]);
    const gtData      = gtSnap.data();
    const ideacomData = ideacomSnap.data();
    console.log('    Global Technics:', JSON.stringify({ name: gtData.name }));
    console.log('    Ideacom:',         JSON.stringify({ name: ideacomData.name }));

    // ── 3. accounts/global-technics ───────────────────────────────────────────
    console.log('\n[3] accounts/global-technics...');
    const gtAccountRef = db.collection('accounts').doc('global-technics');

    await gtAccountRef.set({ name: 'Global Technics', createdAt: now });
    await gtAccountRef.collection('users').doc(EINAR_UID).set({
        email:   EINAR_EMAIL,
        role:    'admin',
        addedAt: now,
    });
    await gtAccountRef.collection('companies').doc(GT_ID).set(gtData);
    console.log('    ✅ accounts/global-technics (account + user + company)');

    // ── 4. accounts/ideacom ───────────────────────────────────────────────────
    console.log('\n[4] accounts/ideacom...');
    const ideacomAccountRef = db.collection('accounts').doc('ideacom');

    await ideacomAccountRef.set({ name: 'Ideacom', createdAt: now });
    await ideacomAccountRef.collection('users').doc(EINAR_UID).set({
        email:   EINAR_EMAIL,
        role:    'admin',
        addedAt: now,
    });
    await ideacomAccountRef.collection('companies').doc(IDEACOM_ID).set(ideacomData);
    console.log('    ✅ accounts/ideacom (account + user + company)');

    console.log('\n✅ Фаза 1 структура создана.');
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Ошибка:', e.message);
    process.exit(1);
});
