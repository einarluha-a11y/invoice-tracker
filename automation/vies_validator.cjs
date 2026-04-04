const https = require('https');

// ── VIES cache (7-day TTL) — avoids repeated API calls for same VAT ──
const _viesCache = new Map();
const VIES_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * Validates a European VAT number against the official European Commission VIES REST API.
 * Results are cached for 7 days to avoid redundant API calls.
 * @param {string} fullVatCode - The full VAT string, starting with a 2-letter Country Code (e.g., "EE101662580").
 * @returns {Promise<Object>} Object containing validity status and registered company name.
 */
function validateVat(fullVatCode) {
    // Check cache first
    const cacheKey = (fullVatCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cached = _viesCache.get(cacheKey);
    if (cached && Date.now() - cached.time < VIES_CACHE_TTL) {
        return Promise.resolve(cached.result);
    }
    const cacheAndResolve = (resolve, result) => {
        // Only cache successful responses (no errors/timeouts)
        if (!result.error) {
            _viesCache.set(cacheKey, { result, time: Date.now() });
        }
        resolve(result);
    };

    return new Promise((resolve) => {
        if (!fullVatCode || typeof fullVatCode !== 'string' || fullVatCode.length < 4) {
            return resolve({ isValid: false, name: null, error: 'Invalid Format' });
        }

        const cleanVat = fullVatCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const countryCode = cleanVat.substring(0, 2);
        const vatNumber = cleanVat.substring(2);

        const payload = JSON.stringify({
            countryCode: countryCode,
            vatNumber: vatNumber
        });

        const options = {
            hostname: 'ec.europa.eu',
            port: 443,
            path: '/taxation_customs/vies/rest-api/check-vat-number',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        return cacheAndResolve(resolve, {
                            isValid: json.valid === true || json.isValid === true,
                            name: json.name || null,
                            address: json.address || null,
                            error: null
                        });
                    } catch (e) {
                        return resolve({ isValid: false, name: null, error: 'JSON Parse Error from VIES' });
                    }
                } else {
                    return resolve({ isValid: false, name: null, error: `VIES API Error: ${res.statusCode}` });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`[VIES API Error] ${e.message}`);
            return resolve({ isValid: false, name: null, error: 'Network Error connecting to VIES' });
        });

        req.setTimeout(5000, () => {
            req.destroy();
            return resolve({ isValid: false, name: null, error: 'VIES API Timeout' });
        });

        req.write(payload);
        req.end();
    });
}

module.exports = { validateVat };
