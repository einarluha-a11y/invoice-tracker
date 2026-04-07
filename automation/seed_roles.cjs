/**
 * seed_roles.cjs — назначить роль 'master' текущему владельцу системы.
 * Запустить один раз: node automation/seed_roles.cjs
 *
 * Читает MASTER_EMAIL из .env (или automation/.env).
 */
require('dotenv').config({ path: __dirname + '/.env' });
require('dotenv').config({ path: __dirname + '/../.env' });

const { admin } = require('./core/firebase.cjs');

const masterEmail = process.env.MASTER_EMAIL;
if (!masterEmail) {
    console.error('MASTER_EMAIL не задан в .env');
    process.exit(1);
}

(async () => {
    try {
        const user = await admin.auth().getUserByEmail(masterEmail);
        await admin.auth().setCustomUserClaims(user.uid, { role: 'master' });
        console.log(`✅ role=master назначен ${masterEmail} (uid: ${user.uid})`);
    } catch (err) {
        console.error('❌ Ошибка:', err.message);
        process.exit(1);
    }
    process.exit(0);
})();
