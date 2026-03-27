const https = require('https');

/**
 * Validates a European VAT number against the official European Commission VIES REST API.
 * @param {string} fullVatCode - The full VAT string, starting with a 2-letter Country Code (e.g., "EE101662580").
 * @returns {Promise<Object>} Object containing validity status and registered company name.
 */
function validateVat(fullVatCode) {
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
                        // The VIES API returns simply: { "isValid": true/false, "name": "REGISTERED_NAME", ... }
                        return resolve({
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

        // Add timeout to prevent hanging the entire ingestion pipeline
        // req.abort() was removed in Node.js v18 — use req.destroy() instead
        req.setTimeout(5000, () => {
            req.destroy();
            return resolve({ isValid: false, name: null, error: 'VIES API Timeout' });
        });

        req.write(payload);
        req.end();
    });
}

module.exports = { validateVat };
