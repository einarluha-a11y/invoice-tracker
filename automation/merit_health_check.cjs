#!/usr/bin/env node
/**
 * Merit Aktiva — проверка подключения
 * Использование: node merit_health_check.cjs
 * Требует: MERIT_API_ID, MERIT_API_KEY в .env или Railway
 *
 * КАК ПОЛУЧИТЬ API КЛЮЧИ в Merit Aktiva:
 *   1. Войти в Merit Aktiva как владелец компании (права администратора)
 *   2. Seaded → Välised ühendused → API
 *   3. Нажать "Lisa uus" (добавить новое подключение)
 *   4. Поле Purpose / Eesmärk: "Invoice-Tracker"
 *   5. Скопировать API ID и API Key → вставить в Railway:
 *      railway variables set MERIT_API_ID=xxx MERIT_API_KEY=yyy
 *   ВАЖНО: создать ключи может только пользователь с правами владельца/администратора.
 *
 * Endpoint /gettaxes используется как health check (GET, не требует тела запроса).
 * /sendinvoice — это POST для отправки инвойсов, не подходит для проверки соединения.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const https = require('https');

const MERIT_API_ID  = process.env.MERIT_API_ID || '';
const MERIT_API_KEY = process.env.MERIT_API_KEY || '';
const MERIT_API_URL = process.env.MERIT_API_URL || 'https://aktiva.merit.ee/api/v1';

if (!MERIT_API_ID || !MERIT_API_KEY) {
    console.error('❌ Не найдены переменные MERIT_API_ID и/или MERIT_API_KEY');
    console.error('   Установить в Railway: railway variables set MERIT_API_ID=xxx MERIT_API_KEY=yyy');
    process.exit(1);
}

function meritTimestamp() {
    const now = new Date();
    return [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, '0'),
        String(now.getUTCDate()).padStart(2, '0'),
        String(now.getUTCHours()).padStart(2, '0'),
        String(now.getUTCMinutes()).padStart(2, '0'),
        String(now.getUTCSeconds()).padStart(2, '0'),
    ].join('');
}

function meritGet(endpoint) {
    return new Promise((resolve, reject) => {
        const timestamp = meritTimestamp();
        const dataToSign = MERIT_API_ID + timestamp + '';
        const hmac = crypto.createHmac('sha256', Buffer.from(MERIT_API_KEY, 'ascii'));
        hmac.update(dataToSign, 'utf-8');
        const signature = encodeURIComponent(hmac.digest('base64'));

        const url = `${MERIT_API_URL}/${endpoint}?ApiId=${MERIT_API_ID}&timestamp=${timestamp}&signature=${signature}`;
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Content-Length': 0 },
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data)); }
                    catch { resolve(data); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    console.log('🔍 Проверка Merit Aktiva подключения...');
    console.log(`   API ID: ${MERIT_API_ID.slice(0, 4)}****`);
    console.log(`   URL:    ${MERIT_API_URL}`);

    try {
        const taxes = await meritGet('gettaxes');
        const count = Array.isArray(taxes) ? taxes.length : '?';
        console.log(`✅ Подключение успешно. Налоговых ставок в Merit: ${count}`);
        if (Array.isArray(taxes) && taxes.length > 0) {
            console.log('   Примеры:', taxes.slice(0, 3).map(t => `${t.Code || t.code}: ${t.Name || t.name || ''}`).join(', '));
        }
        process.exit(0);
    } catch (err) {
        console.error('❌ Ошибка подключения:', err.message);
        console.error('   Проверь MERIT_API_ID и MERIT_API_KEY из Merit: Seaded → Välised ühendused → API');
        process.exit(1);
    }
}

main();
