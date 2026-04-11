/**
 * Dropbox Service — прямая интеграция с Dropbox API v2 без Zapier.
 * Использует OAuth2 refresh token flow (APP_KEY + APP_SECRET + REFRESH_TOKEN).
 * Fallback: DROPBOX_ACCESS_TOKEN для совместимости.
 */
require('dotenv').config({ path: __dirname + '/.env' });

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const DROPBOX_ACCESS_TOKEN_STATIC = process.env.DROPBOX_ACCESS_TOKEN;

// Кэш access token с временем истечения
let _cachedToken = null;
let _tokenExpiry = 0;

async function _fetch() {
    const { default: fetch } = await import('node-fetch');
    return fetch;
}

/**
 * Получает свежий access token через refresh token flow.
 * Кэширует на 3 часа (токены живут 4 часа).
 */
async function getAccessToken() {
    // Если статический токен задан — использовать его
    if (!DROPBOX_REFRESH_TOKEN && DROPBOX_ACCESS_TOKEN_STATIC) {
        return DROPBOX_ACCESS_TOKEN_STATIC;
    }

    if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) {
        throw new Error('Dropbox OAuth2 credentials not set: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN');
    }

    // Проверить кэш
    if (_cachedToken && Date.now() < _tokenExpiry) {
        return _cachedToken;
    }

    const fetch = await _fetch();
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET
    });

    const res = await fetch('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Dropbox token refresh failed: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    _cachedToken = data.access_token;
    // Кэшировать на 3 часа (10800 секунд), даже если expires_in больше
    _tokenExpiry = Date.now() + Math.min((data.expires_in || 14400) * 1000, 3 * 60 * 60 * 1000);
    return _cachedToken;
}

/**
 * Создаёт папку в Dropbox (включая все родительские). Не бросает ошибку если папка уже есть.
 * @param {string} folderPath - Например: '/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3'
 */
async function createCompanyFolder(folderPath) {
    const token = await getAccessToken();
    const fetch = await _fetch();
    const res = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
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
    const token = await getAccessToken();
    const fetch = await _fetch();

    await createCompanyFolder(folderPath);

    const filePath = `${folderPath}/${invoiceId}.pdf`;
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
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
    const token = await getAccessToken();
    const fetch = await _fetch();
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
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
 * Resolve the Dropbox folder structure for a given company.
 *
 * Source of truth (in priority order):
 *   1. `dropboxConfig` field on the Firestore companies/{id} doc:
 *        { folderBasePath: "IDEACOM", folderPrefix: "IC" }
 *      This is the new way — settable per-company through the Settings page,
 *      no code changes needed when a new accounting entity is added.
 *
 *   2. Hardcoded heuristic match on company name (legacy fallback for the
 *      two original tenants — IDEACOM and GLOBAL TECHNICS — so existing
 *      data keeps flowing without a manual migration of dropboxConfig).
 *
 *   3. UNKNOWN_COMPANY / UK as a last-resort default.
 *
 * Returns `{ folderBasePath, folderPrefix }`. Pure function — does not
 * touch Firestore. The caller is responsible for fetching the company
 * doc and passing in `companyDocData` if it has one.
 */
function resolveDropboxConfig(companyName, companyDocData) {
    // 1. Per-company config from Firestore
    if (companyDocData && companyDocData.dropboxConfig) {
        const cfg = companyDocData.dropboxConfig;
        if (cfg.folderBasePath && cfg.folderPrefix) {
            return {
                folderBasePath: cfg.folderBasePath,
                folderPrefix: cfg.folderPrefix,
                source: 'firestore',
            };
        }
    }

    // 2. Legacy heuristic — only the two original tenants
    const compNameUpper = (companyName || '').toUpperCase();
    if (compNameUpper.includes('IDEACOM')) {
        return { folderBasePath: 'IDEACOM', folderPrefix: 'IC', source: 'legacy' };
    }
    if (compNameUpper.includes('GLOBAL TECHNICS')) {
        return { folderBasePath: 'GLOBAL TECHNICS', folderPrefix: 'GT', source: 'legacy' };
    }

    // 3. Last-resort default
    return { folderBasePath: 'UNKNOWN_COMPANY', folderPrefix: 'UK', source: 'default' };
}

/**
 * Build the Dropbox folder path for a given invoice.
 *
 * @param {string} companyName    — receiver company name from Firestore
 * @param {string} year           — "2026"
 * @param {string} month          — "3"
 * @param {object} [companyDocData] — full Firestore companies/{id} doc data,
 *                                  used to read .dropboxConfig if present
 * @returns {string} absolute Dropbox path
 *   e.g. "/IDEACOM/IC_ARVED/IC_arved_meile/IC_arved_meile_2026/IC_arved_meile_2026_3"
 */
function buildDropboxFolderPath(companyName, year, month, companyDocData) {
    const { folderBasePath, folderPrefix } = resolveDropboxConfig(companyName, companyDocData);
    return `/${folderBasePath}/${folderPrefix}_ARVED/${folderPrefix}_arved_meile/${folderPrefix}_arved_meile_${year}/${folderPrefix}_arved_meile_${year}_${month}`;
}

module.exports = { uploadInvoiceToPDF, createCompanyFolder, listInvoicesInFolder, buildDropboxFolderPath, resolveDropboxConfig, getAccessToken };

// CLI тест: node automation/dropbox_service.cjs --test
if (require.main === module) {
    (async () => {
        try {
            const token = await getAccessToken();
            const fetch = await _fetch();
            const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
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
        } catch (e) {
            console.error('[Dropbox] ❌', e.message);
            process.exit(1);
        }
    })();
}
