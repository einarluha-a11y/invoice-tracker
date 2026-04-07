/**
 * Dropbox Service — прямая интеграция с Dropbox API v2 без Zapier.
 * Использует Bearer-токен из env DROPBOX_ACCESS_TOKEN.
 */
require('dotenv').config({ path: __dirname + '/.env' });

const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

async function _fetch() {
    const { default: fetch } = await import('node-fetch');
    return fetch;
}

/**
 * Создаёт папку в Dropbox (включая все родительские). Не бросает ошибку если папка уже есть.
 * @param {string} folderPath - Например: '/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3'
 */
async function createCompanyFolder(folderPath) {
    if (!DROPBOX_ACCESS_TOKEN) throw new Error('DROPBOX_ACCESS_TOKEN not set in .env');
    const fetch = await _fetch();
    const res = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: folderPath, autorename: false })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // папка уже существует — не ошибка
        if (err?.error?.path?.['.tag'] === 'conflict') return;
        throw new Error(`Dropbox create_folder failed: ${JSON.stringify(err)}`);
    }
}

/**
 * Загружает PDF-буфер в Dropbox в указанную папку.
 * @param {string} invoiceId - Используется как имя файла (invoiceId.pdf)
 * @param {Buffer} pdfBuffer - Байты PDF файла
 * @param {string} folderPath - Целевая папка в Dropbox
 * @returns {string} Путь к загруженному файлу в Dropbox
 */
async function uploadInvoiceToPDF(invoiceId, pdfBuffer, folderPath) {
    if (!DROPBOX_ACCESS_TOKEN) throw new Error('DROPBOX_ACCESS_TOKEN not set in .env');
    const fetch = await _fetch();

    await createCompanyFolder(folderPath);

    const filePath = `${folderPath}/${invoiceId}.pdf`;
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Dropbox-API-Arg': JSON.stringify({
                path: filePath,
                mode: 'overwrite',
                autorename: false,
                mute: false
            }),
            'Content-Type': 'application/octet-stream'
        },
        body: pdfBuffer
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Dropbox upload failed: ${JSON.stringify(err)}`);
    }
    return filePath;
}

/**
 * Список файлов в папке Dropbox.
 * @param {string} folderPath - Путь к папке в Dropbox
 * @returns {Array} Список файлов
 */
async function listInvoicesInFolder(folderPath) {
    if (!DROPBOX_ACCESS_TOKEN) throw new Error('DROPBOX_ACCESS_TOKEN not set in .env');
    const fetch = await _fetch();
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: folderPath, recursive: false })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Dropbox list_folder failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.entries || [];
}

/**
 * Вычисляет путь к папке в Dropbox по имени компании, году и месяцу.
 * Сохраняет существующую структуру папок.
 * @param {string} companyName - Имя компании из Firestore
 * @param {string} year - Год (напр. "2026")
 * @param {string} month - Месяц (напр. "3")
 * @returns {string} Путь к папке в Dropbox
 */
function buildDropboxFolderPath(companyName, year, month) {
    let folderBasePath = 'UNKNOWN_COMPANY';
    let folderPrefix = 'UK';

    const compNameUpper = (companyName || '').toUpperCase();
    if (compNameUpper.includes('IDEACOM')) {
        folderBasePath = 'IDEACOM';
        folderPrefix = 'IC';
    } else if (compNameUpper.includes('GLOBAL TECHNICS')) {
        folderBasePath = 'GLOBAL TECHNICS';
        folderPrefix = 'GT';
    }

    return `/${folderBasePath}/${folderPrefix}_ARVED/${folderPrefix}_arved_meile/${folderPrefix}_arved_meile_${year}/${folderPrefix}_arved_meile_${year}_${month}`;
}

module.exports = { uploadInvoiceToPDF, createCompanyFolder, listInvoicesInFolder, buildDropboxFolderPath };

// CLI тест: node automation/dropbox_service.cjs --test
if (require.main === module) {
    (async () => {
        if (!DROPBOX_ACCESS_TOKEN) {
            console.error('[Dropbox] ❌ DROPBOX_ACCESS_TOKEN не задан в .env');
            process.exit(1);
        }
        const fetch = await _fetch();
        const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: 'null'
        });
        if (res.ok) {
            const user = await res.json();
            console.log(`[Dropbox] ✅ Подключено: ${user.email} (${user.name?.display_name})`);
        } else {
            const err = await res.json().catch(() => ({}));
            console.error('[Dropbox] ❌ Ошибка подключения:', res.status, JSON.stringify(err));
            process.exit(1);
        }
    })();
}
