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
    
    // 3. Mandatory Registration Data
    // Note: If the Pure AI explicitly checked and swore it doesn't exist, it sets it to NOT_FOUND_ON_INVOICE.
    const isRegExplicitlyNotFound = invoiceData.supplierRegistration === "NOT_FOUND_ON_INVOICE";
    const isVatExplicitlyNotFound = invoiceData.supplierVat === "NOT_FOUND_ON_INVOICE";

    if (!invoiceData.supplierRegistration && !isRegExplicitlyNotFound) {
        missingFields.push("Supplier Registration Number");
    }
    if (!invoiceData.supplierVat && !isVatExplicitlyNotFound) {
        missingFields.push("Supplier VAT Number");
    }

    // Evaluate the psychological state of the Supervisor
    if (missingFields.length > 0) {
        critique = `You missed the following critical fields: ${missingFields.join(', ')}. Please completely re-scan the document, check the extreme margins, small text, and footers for the Registration Codes, VAT numbers, and explicit Subtotal/Tax breakdowns.`;
        
        console.log(`[Supervisor] 🚨 UNACCEPTABLE. Missing core data: ${missingFields.join(', ')}`);
        return { 
            passed: false, 
            needsReExtraction: true,
            critique: critique 
        };
    } else {
        // The Supervisor "calms down" because either everything is present, OR the AI explicitly confirmed it doesn't exist.
        console.log(`[Supervisor] 😌 I am calm. All requested parameters are either present or explicitly confirmed absent by the Engine.`);
        
        // Clean up the NOT_FOUND string before it goes to Firestore
        if (invoiceData.supplierRegistration === "NOT_FOUND_ON_INVOICE") invoiceData.supplierRegistration = "";
        if (invoiceData.supplierVat === "NOT_FOUND_ON_INVOICE") invoiceData.supplierVat = "";

        return { 
            passed: true, 
            needsReExtraction: false,
            reason: "All clear"
        };
    }
}

module.exports = { intellectualSupervisorGate };
