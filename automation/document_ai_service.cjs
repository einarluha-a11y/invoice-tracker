// document_ai_service.cjs — СЛЕДОПЫТ (Scout Agent)
//
// =============================================================================
// ОБЯЗАТЕЛЬНЫЕ ПОЛЯ ИНВОЙСА (11 штук) — все должны быть заполнены перед записью
// =============================================================================
//  1. vendorName           — название компании-поставщика (Tarnija)
//  2. invoiceId            — номер инвойса (Arve nr / invoice number, e.g. P-10963)
//  3. description          — товар/услуга из первой строки позиции (Kirjeldus)
//  4. amount               — итоговая сумма с НДС (Summa kokku / Total)
//  5. currency             — валюта ISO (EUR, USD и т.д.)
//  6. dateCreated          — дата инвойса YYYY-MM-DD (Kuupäev / Invoice date)
//  7. dueDate              — срок оплаты YYYY-MM-DD (Maksetähtaeg / Due date)
//  8. supplierVat          — KMKR nr поставщика (VAT registration, e.g. EE102076039)
//  9. supplierRegistration — Rg-kood поставщика (Company reg. code, e.g. 14499687)
// 10. subtotalAmount       — сумма без НДС (Summa km-ta / Net amount)
// 11. taxAmount            — сумма НДС (Käibemaks / VAT amount)
//
// Status (12-е поле) определяется бизнес-логикой, НЕ извлечением.
//
// ЭТАПЫ ИЗВЛЕЧЕНИЯ:
//   Шаг 1: Google Document AI — быстрый, бесплатный, хорошо для стандартных полей
//   Шаг 2: Regex по тексту DocAI — добирает эстонские/англ./нем./рус. метки
//   Пустые поля после шагов 1-2 остаются как есть — Учитель (teacher_agent) их подхватит
// =============================================================================

const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { serviceAccount } = require('./core/firebase.cjs');

// --- Google Document AI Setup ---
const docaiClient = new DocumentProcessorServiceClient({
    credentials: serviceAccount,
    apiEndpoint: 'eu-documentai.googleapis.com'
});
const PROJECT_ID = 'invoice-tracker-xyz';
const LOCATION = 'eu';
const PROCESSOR_ID = '8087614a36686ed4'; // Invoice Parser
const PROCESSOR_NAME = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

/**
 * Parse a numeric string into a float, handling European formats (1.200,50 or 1,200.50)
 */
function cleanNum(str) {
    if (!str && str !== 0) return 0;
    let s = String(str).replace(/[^\d.,-]/g, '').trim();
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    return parseFloat(s) || 0;
}

/**
 * Convert Document AI date mentionText (various formats) to YYYY-MM-DD string.
 */
function parseDocAiDate(text) {
    if (!text) return null;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const euroSlash = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (euroSlash) {
        const [, d, m, y] = euroSlash;
        const year = y.length === 2 ? `20${y}` : y;
        return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
}

/**
 * Infer description from vendor name when document has no explicit service description.
 */
function inferDescription(vendorName) {
    const v = (vendorName || '').toLowerCase();
    if (/nunner|girteka|linava|dsv|transport|freight|logistics|cargo|express|kuller|post/i.test(v)) return 'Freight forwarding';
    if (/kindlustus|insurance|assurance/i.test(v)) return 'Insurance premium';
    if (/rent|üür|arrend/i.test(v)) return 'Office rent';
    return '';
}

/**
 * ШАГ 2: Regex-извлечение эстонских меток из сырого текста DocAI.
 * Заполняет только те поля, которые DocAI пропустил.
 *
 * Поддерживаемые эстонские метки:
 *   KMKR nr       → supplierVat       (VAT registration number)
 *   Rg-kood       → supplierRegistration (company registration code)
 *   Summa km-ta   → subtotalAmount    (net amount excl. VAT)
 *   Käibemaks     → taxAmount         (VAT amount)
 *   Summa kokku   → amount            (total incl. VAT)
 *   Arve nr       → invoiceId         (invoice number)
 *   Kuupäev       → dateCreated       (invoice date)
 *   Maksetähtaeg  → dueDate           (payment due date)
 */
function applyEstonianRegexFallback(rawText, result) {
    const t = rawText || '';
    const filled = [];

    // supplierVat: KMKR nr EE102076039
    if (!result.supplierVat || result.supplierVat === 'Not_Found' || result.supplierVat === '') {
        const m = t.match(/KMKR\s*nr\s+([A-Z]{2}\d{6,12})/i);
        if (m) { result.supplierVat = m[1]; filled.push('supplierVat'); }
    }

    // supplierRegistration: Rg-kood 14499687
    if (!result.supplierRegistration || result.supplierRegistration === 'Not_Found' || result.supplierRegistration === '') {
        const m = t.match(/Rg-?kood\s+(\d{6,10})/i);
        if (m) { result.supplierRegistration = m[1]; filled.push('supplierRegistration'); }
    }

    // subtotalAmount: "Summa km-ta 24% 33,24" or "Summa km-ta 33.24"
    if (!result.subtotalAmount || result.subtotalAmount === 0) {
        const m = t.match(/Summa\s+km-?ta\s+(?:\d+%\s+)?([\d\s,.]+)/i);
        if (m) { const v = cleanNum(m[1]); if (v > 0) { result.subtotalAmount = v; filled.push('subtotalAmount'); } }
    }

    // taxAmount: "Käibemaks 24% 7,98" or "Käibemaks 7.98"
    if (!result.taxAmount || result.taxAmount === 0) {
        const m = t.match(/Käibemaks\s+(?:\d+%\s+)?([\d\s,.]+)/i);
        if (m) { const v = cleanNum(m[1]); if (v > 0) { result.taxAmount = v; filled.push('taxAmount'); } }
    }

    // amount fallback: "Summa kokku (EUR) 41,22"
    if (!result.amount || result.amount === 0) {
        const m = t.match(/Summa\s+kokku\s+(?:\([A-Z]+\)\s+)?([\d\s,.]+)/i);
        if (m) { const v = cleanNum(m[1]); if (v > 0) { result.amount = v; filled.push('amount'); } }
    }

    // invoiceId fallback: "Ettemaksuarve nr P-10963" or "Arve nr 2024/001"
    // Requires "nr" to be present — avoids matching "Arve saaja" (recipient field)
    if (!result.invoiceId || result.invoiceId.startsWith('Auto-')) {
        const m = t.match(/(?:Ettemaksuarve|Arve)\s+nr\s+([A-Z0-9][A-Z0-9\-\/]{1,30})/i)
                || t.match(/Invoice\s*(?:No|Nr|#)[.:\s]+([A-Z0-9][A-Z0-9\-\/]{1,30})/i);
        if (m && !m[1].match(/^\d{4}-\d{2}-\d{2}$/)) { result.invoiceId = m[1].trim(); filled.push('invoiceId'); }
    }

    // dateCreated fallback: "Kuupäev 30.03.2026"
    if (!result.dateCreated) {
        const m = t.match(/Kuup[äa]ev\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i);
        if (m) { result.dateCreated = parseDocAiDate(m[1]); if (result.dateCreated) filled.push('dateCreated'); }
    }

    // dueDate fallback: "Maksetähtpäev 30.03.2026" or "Maksetähtaeg 30.03.2026"
    if (!result.dueDate) {
        const m = t.match(/Makset[äa]ht(?:p[äa]ev|aeg)\s+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i);
        if (m) { result.dueDate = parseDocAiDate(m[1]); if (result.dueDate) filled.push('dueDate'); }
    }

    if (filled.length > 0) {
        console.log(`[Regex Fallback] ✅ Filled from Estonian text: ${filled.join(', ')}`);
    }
    return result;
}

/**
 * ШАГ 2b: Расширенный regex — многоязычные паттерны (EN/DE/RU/PL).
 * Заполняет поля, которые DocAI и эстонский regex не нашли.
 */
function applyMultiLanguageRegexFallback(rawText, result) {
    const t = rawText || '';
    const filled = [];

    // description: первая позиция из line items в тексте
    if (!result.description || result.description.trim() === '') {
        // Ищем паттерны типа "1. Some product description" или "1 Some product 12.50"
        const m = t.match(/(?:^|\n)\s*1[.)]\s+(.{5,80})/m)
               || t.match(/(?:Kirjeldus|Description|Beschreibung|Описание|Opis)[:\s]+(.{5,80})/i);
        if (m) { result.description = m[1].replace(/\s+/g, ' ').trim(); filled.push('description'); }
    }

    // vendorName: fallback from common headers
    if (!result.vendorName || result.vendorName === 'Unknown Vendor') {
        const m = t.match(/(?:Tarnija|Müüja|Supplier|Lieferant|Поставщик|Dostawca)[:\s]+(.{3,60})/i);
        if (m) { result.vendorName = m[1].trim(); filled.push('vendorName'); }
    }

    // currency: extract from text near amounts
    if (!result.currency || result.currency === 'EUR') {
        const m = t.match(/\b(USD|GBP|PLN|SEK|NOK|DKK|CHF|CZK|RUB)\b/);
        if (m) { result.currency = m[1]; filled.push('currency'); }
    }

    // supplierVat: international formats (LT, LV, PL, DE, FI)
    if (!result.supplierVat || result.supplierVat === 'Not_Found' || result.supplierVat === '') {
        const m = t.match(/(?:VAT|PVM|PVN|NIP|USt-?Id|ИНН|IČO)[.\s:№]*\s*([A-Z]{2}\d{6,12})/i)
               || t.match(/\b([A-Z]{2}\d{8,12})\b/);
        if (m) { result.supplierVat = m[1]; filled.push('supplierVat'); }
    }

    // supplierRegistration: international reg. codes
    if (!result.supplierRegistration || result.supplierRegistration === 'Not_Found' || result.supplierRegistration === '') {
        const m = t.match(/(?:Reg\.?\s*(?:nr|code|kood|код)|Įmonės\s+kodas|Reģ\.?\s*Nr)[.:\s]+(\d{6,12})/i);
        if (m) { result.supplierRegistration = m[1]; filled.push('supplierRegistration'); }
    }

    // dateCreated: international date labels
    if (!result.dateCreated) {
        const m = t.match(/(?:Invoice\s+date|Rechnungsdatum|Дата\s+счета|Data\s+faktury)[:\s]+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i)
               || t.match(/(?:Date)[:\s]+(\d{4}-\d{2}-\d{2})/i);
        if (m) { result.dateCreated = parseDocAiDate(m[1]); if (result.dateCreated) filled.push('dateCreated'); }
    }

    // dueDate: international labels
    if (!result.dueDate) {
        const m = t.match(/(?:Due\s+date|Fällig|Срок\s+оплаты|Termin\s+płatności|Payment\s+due)[:\s]+(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i)
               || t.match(/(?:Due|Fällig)[:\s]+(\d{4}-\d{2}-\d{2})/i);
        if (m) { result.dueDate = parseDocAiDate(m[1]); if (result.dueDate) filled.push('dueDate'); }
    }

    // subtotalAmount: international labels
    if (!result.subtotalAmount || result.subtotalAmount === 0) {
        const m = t.match(/(?:Subtotal|Net\s+amount|Nettosumme|Сумма\s+без\s+НДС|Netto)[:\s]+([\d\s,.]+)/i);
        if (m) { const v = cleanNum(m[1]); if (v > 0) { result.subtotalAmount = v; filled.push('subtotalAmount'); } }
    }

    // taxAmount: international labels
    if (!result.taxAmount || result.taxAmount === 0) {
        const m = t.match(/(?:VAT\s+amount|Tax|MwSt|НДС|Podatek\s+VAT)[:\s]+(?:\d+%\s+)?([\d\s,.]+)/i);
        if (m) { const v = cleanNum(m[1]); if (v > 0) { result.taxAmount = v; filled.push('taxAmount'); } }
    }

    if (filled.length > 0) {
        console.log(`[Regex Multilang] ✅ Filled from multilingual text: ${filled.join(', ')}`);
    }
    return result;
}

/**
 * Main extraction function — СЛЕДОПЫТ (Scout Agent).
 * Шаг 1: DocAI → Шаг 2: Regex (эстонские метки) → Шаг 2b: Regex (многоязычный)
 * Пустые поля остаются как есть — Учитель (teacher_agent) заполнит из образцов.
 *
 * @param {Buffer} buffer            Raw file bytes (PDF or image)
 * @param {string} mimeType          MIME type, e.g. 'application/pdf'
 * @param {string|null} supervisorCritique  Deprecated — kept for API compat
 * @param {string|null} customRules  Deprecated — kept for API compat
 * @param {string|null} vendorHint   Deprecated — kept for API compat
 * @returns {Promise<Array>} Array of invoice objects or []
 */
async function processInvoiceWithDocAI(buffer, mimeType = 'application/pdf', supervisorCritique = null, customRules = null, vendorHint = null) {
    console.log(`[DocAI] 📄 Sending document to Google Document AI Invoice Parser (${PROCESSOR_ID})...`);

    try {
        const request = {
            name: PROCESSOR_NAME,
            rawDocument: {
                content: buffer.toString('base64'),
                mimeType: mimeType || 'application/pdf',
            },
        };

        const [result] = await docaiClient.processDocument(request);
        const { document } = result;

        if (!document || !document.entities || document.entities.length === 0) {
            console.warn('[DocAI] ⚠️  Document AI returned no entities — document may be junk/empty.');
            return [];
        }

        // --- ШАГ 1: Map Document AI entities to invoice schema ---
        let vendorName = 'Unknown Vendor';
        let invoiceId = `Auto-${Date.now()}`;
        let dateCreated = null;
        let dueDate = null;
        let amount = 0;
        let taxAmount = 0;
        let subtotalAmount = 0;
        let currency = 'EUR';
        let supplierVat = '';
        let supplierRegistration = '';
        let receiverName = '';
        let receiverVat = '';
        let paymentTerms = '';
        let descriptionText = '';
        const lineItems = [];
        const confidenceScores = {};

        for (const entity of document.entities) {
            const text = (entity.mentionText || '').trim();
            const conf = entity.confidence || 0;

            switch (entity.type) {
                case 'supplier_name':
                    vendorName = text;
                    confidenceScores.vendor = conf;
                    break;
                case 'invoice_id':
                    invoiceId = text;
                    confidenceScores.invoiceId = conf;
                    break;
                case 'invoice_date':
                case 'issue_date':
                    dateCreated = (entity.normalizedValue && entity.normalizedValue.text)
                        ? entity.normalizedValue.text.split('T')[0]
                        : parseDocAiDate(text);
                    break;
                case 'due_date':
                    dueDate = (entity.normalizedValue && entity.normalizedValue.text)
                        ? entity.normalizedValue.text.split('T')[0]
                        : parseDocAiDate(text);
                    break;
                case 'total_amount':
                    amount = cleanNum(text);
                    confidenceScores.total = conf;
                    break;
                case 'total_tax_amount':
                    taxAmount = cleanNum(text);
                    break;
                case 'net_amount':
                case 'subtotal':
                    subtotalAmount = cleanNum(text);
                    break;
                case 'currency':
                    currency = text.toUpperCase() || 'EUR';
                    break;
                case 'supplier_tax_id':
                    supplierVat = text || '';
                    break;
                case 'supplier_registration_number':
                    supplierRegistration = text || '';
                    break;
                case 'receiver_name':
                    receiverName = text;
                    break;
                case 'receiver_tax_id':
                    receiverVat = text;
                    break;
                case 'payment_terms':
                    paymentTerms = text;
                    break;
                case 'description':
                case 'service_description':
                    if (text && text.length > 3) descriptionText = text;
                    break;
                case 'line_item': {
                    let itemDesc = '';
                    let itemAmt = 0;
                    if (entity.properties) {
                        const d = entity.properties.find(p => p.type === 'line_item/description');
                        const a = entity.properties.find(p => p.type === 'line_item/amount');
                        if (d) itemDesc = (d.mentionText || '').replace(/\n/g, ' ').trim();
                        if (a) itemAmt = cleanNum(a.mentionText);
                    }
                    if (itemDesc || itemAmt) lineItems.push({ description: itemDesc, amount: itemAmt });
                    break;
                }
            }
        }

        // Build description from DocAI results (before regex/Claude steps)
        const docAiDescription = descriptionText && descriptionText.length > 3
            ? descriptionText
            : (lineItems.length > 0 && lineItems[0].description ? lineItems[0].description : '');

        // Assemble partial result for Шаги 2-3
        let partial = {
            invoiceId,
            vendorName,
            supplierRegistration,
            supplierVat,
            receiverName,
            receiverVat,
            amount,
            taxAmount,
            subtotalAmount,
            currency,
            dateCreated,
            dueDate,
            description: docAiDescription,
            paymentTerms,
            lineItems,
        };

        // --- ШАГ 2: Regex fallback for Estonian labels ---
        const rawDocText = document.text || '';
        partial = applyEstonianRegexFallback(rawDocText, partial);

        // --- ШАГ 2b: Multilingual regex fallback (EN/DE/RU/PL) ---
        partial = applyMultiLanguageRegexFallback(rawDocText, partial);

        // --- Final fallbacks ---
        // NOTE: Do NOT default dates to today — leave blank if not found, so UI shows "—" instead of wrong date.
        if (!partial.dateCreated) partial.dateCreated = '';
        if (!partial.dueDate) partial.dueDate = '';

        // Description: if still empty after all steps, infer from vendor
        if (!partial.description || partial.description.trim() === '') {
            partial.description = inferDescription(partial.vendorName);
        }

        // subtotalAmount fallback: if total known but sub/tax still 0 (invoice without VAT breakdown)
        if (partial.subtotalAmount === 0 && partial.taxAmount === 0 && partial.amount > 0) {
            partial.subtotalAmount = partial.amount;
        }

        // Determine status — default Pending (Ootel)
        const status = 'Pending';

        // --- Validation warnings ---
        const validationWarnings = [];
        const computedTotal = parseFloat((partial.subtotalAmount + partial.taxAmount).toFixed(2));
        if (partial.amount > 0 && partial.subtotalAmount > 0 && Math.abs(computedTotal - partial.amount) > 0.05) {
            validationWarnings.push(`Math mismatch: ${partial.subtotalAmount} + ${partial.taxAmount} ≠ ${partial.amount}`);
        }
        if ((confidenceScores.total || 0) < 0.6 || (confidenceScores.vendor || 0) < 0.6) {
            validationWarnings.push(`Low DocAI confidence: total=${(confidenceScores.total||0).toFixed(2)}, vendor=${(confidenceScores.vendor||0).toFixed(2)}`);
        }
        if (partial.amount === 0) {
            validationWarnings.push('Total amount not extracted — manual review required');
        }

        console.log(`[DocAI] ✅ Extraction complete: vendor="${partial.vendorName}", invoiceId="${partial.invoiceId}", amount=${partial.amount} ${partial.currency}`);

        return [{
            type: 'INVOICE',
            invoiceId:            partial.invoiceId,
            vendorName:           partial.vendorName,
            supplierRegistration: partial.supplierRegistration,
            supplierVat:          partial.supplierVat,
            receiverName:         partial.receiverName,
            receiverVat:          partial.receiverVat,
            amount:               partial.amount,
            taxAmount:            partial.taxAmount,
            subtotalAmount:       partial.subtotalAmount,
            currency:             partial.currency,
            dateCreated:          partial.dateCreated,
            dueDate:              partial.dueDate,
            status,
            description:          partial.description,
            paymentTerms:         partial.paymentTerms,
            lineItems:            partial.lineItems,
            validationWarnings:   validationWarnings.length > 0 ? validationWarnings : undefined,
        }];

    } catch (error) {
        console.error(`[DocAI] 🚨 Extraction failed:`, error.message);
        throw error;
    }
}

module.exports = { processInvoiceWithDocAI, cleanNum, parseDocAiDate, inferDescription };
