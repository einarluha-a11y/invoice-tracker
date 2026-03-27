const COMPANY_MARKERS_REGEX = /\b(OÜ|AS|Ltd|LLC|GmbH|SIA|UAB|Sp\.?\s*z\s*o\.?o\.?|S\.A\.|Inc|Corp|BV|NV|SRL|SARL)\b/i;

function isPrivatePerson(vendorName) {
    if (!vendorName) return true; // If no name, safely assume no company rules apply
    return !COMPANY_MARKERS_REGEX.test(vendorName);
}

function stripCompanyMarkers(vendorName) {
    if (!vendorName) return '';
    // Use new RegExp with the source to apply global replacement
    return vendorName.replace(new RegExp(COMPANY_MARKERS_REGEX.source, 'gi'), '').trim();
}

module.exports = {
    COMPANY_MARKERS_REGEX,
    isPrivatePerson,
    stripCompanyMarkers
};
