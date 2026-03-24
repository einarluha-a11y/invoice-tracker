/**
 * THE SUPREME SUPERVISOR AGENT
 * This Agent executes purely intellectual, logical reasoning on the final parsed payload.
 * It enforces mandatory fields and talks back to the Pure AI Engine if data is missing.
 */
async function intellectualSupervisorGate(invoiceData) {
    let critique = "";
    let missingFields = [];

    console.log(`[Supervisor] 🦅 Scanning extracted payload for mandatory accounting variables...`);

    // 1. Mandatory Mathematical Fields
    if (invoiceData.amount === 0 || invoiceData.amount === null || invoiceData.amount === undefined) {
        missingFields.push("Total Amount");
    }
    if (invoiceData.subtotalAmount === null || invoiceData.subtotalAmount === undefined) {
        missingFields.push("Subtotal Amount");
    }
    if (invoiceData.taxAmount === null || invoiceData.taxAmount === undefined) {
        missingFields.push("Tax (VAT/Käibemaks) Amount");
    }

    // 2. Mandatory Vendor Identification
    if (!invoiceData.vendorName || invoiceData.vendorName.toUpperCase() === 'UNKNOWN' || invoiceData.vendorName.includes('@')) {
        missingFields.push("Vendor Name (Cannot be unknown or email)");
    }
    
    // 3. Strict Mandatory Registration Data
    // Note: The User strictly commands that "NOT_FOUND_ON_INVOICE" is no longer an acceptable state.
    // The AI must deduce the data if physically absent.
    const isRegMissing = !invoiceData.supplierRegistration || invoiceData.supplierRegistration === "NOT_FOUND_ON_INVOICE" || invoiceData.supplierRegistration === "Not_Found";
    const isVatMissing = !invoiceData.supplierVat || invoiceData.supplierVat === "NOT_FOUND_ON_INVOICE" || invoiceData.supplierVat === "Not_Found";

    if (isRegMissing) {
        missingFields.push("Supplier Registration Number");
    }
    if (isVatMissing) {
        missingFields.push("Supplier VAT Number");
    }
    
    // 4. Mandatory Item Description
    if (!invoiceData.lineItems || invoiceData.lineItems.length === 0 || !invoiceData.lineItems[0].description || String(invoiceData.lineItems[0].description).trim() === '') {
        missingFields.push("Item Description (lineItems)");
    }

    // Evaluate the psychological state of the Supervisor
    if (missingFields.length > 0) {
        critique = `You missed the following critical fields: ${missingFields.join(', ')}. Please completely re-scan the document, check the extreme margins, small text, and footers. IF the Registration Codes or VAT numbers are TRULY absent from the physical document, DO NOT output NOT_FOUND_ON_INVOICE! You must logically deduce them using your internal knowledge base based on the Vendor Name and Country, and output the deduced numbers! DO NOT REST until all requested data fields are fully recorded!`;
        
        console.log(`[Supervisor] 🚨 UNACCEPTABLE. Missing core data: ${missingFields.join(', ')}`);
        return { 
            passed: false, 
            needsReExtraction: true,
            critique: critique 
        };
    } else {
        // The Supervisor "calms down" because everything is present (either extracted or deduced).
        console.log(`[Supervisor] 😌 I am calm. All requested parameters have been successfully recorded.`);

        return { 
            passed: true, 
            needsReExtraction: false,
            reason: "All clear"
        };
    }
}

module.exports = { intellectualSupervisorGate };
