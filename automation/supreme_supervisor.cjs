// DEPRECATED: Supervisor logic has been replaced by Teacher Agent (teacher_agent.cjs).
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
    const parsedAmount = parseFloat(String(invoiceData.amount).replace(/[^0-9.-]+/g, '')) || 0;
    if (parsedAmount === 0 || invoiceData.amount === null || invoiceData.amount === undefined || invoiceData.amount === "Not_Found") {
        missingFields.push("Total Amount");
    }
    
    const parsedSub = parseFloat(String(invoiceData.subtotalAmount).replace(/[^0-9.-]+/g, ''));
    if (isNaN(parsedSub) || invoiceData.subtotalAmount === null || invoiceData.subtotalAmount === undefined) {
        missingFields.push("Subtotal Amount");
    }
    
    const parsedTax = parseFloat(String(invoiceData.taxAmount).replace(/[^0-9.-]+/g, ''));
    if (isNaN(parsedTax) || invoiceData.taxAmount === null || invoiceData.taxAmount === undefined) {
        missingFields.push("Tax (VAT/Käibemaks) Amount");
    }

    // 2. Mandatory Vendor Identification & Invoice ID
    if (!invoiceData.vendorName || invoiceData.vendorName.toUpperCase() === 'UNKNOWN' || invoiceData.vendorName.includes('@') || invoiceData.vendorName === "Not_Found") {
        missingFields.push("Vendor Name (Cannot be unknown or email)");
    }
    if (!invoiceData.invoiceId || invoiceData.invoiceId === "Not_Found" || String(invoiceData.invoiceId).trim() === "") {
        missingFields.push("Invoice ID (Number)");
    }
    
    // 3. Strict Mandatory Registration Data
    // Private persons (no company suffix) are exempt from VAT/Reg requirements.
    // Demanding these fields for private persons causes 5 pointless re-extraction attempts.
    const { isPrivatePerson } = require('./core/business_rules.cjs');
    const isPrivate = isPrivatePerson(invoiceData.vendorName);

    if (!isPrivate) {
        const isRegMissing = !invoiceData.supplierRegistration || invoiceData.supplierRegistration === "NOT_FOUND_ON_INVOICE" || invoiceData.supplierRegistration === "Not_Found";
        const isVatMissing = !invoiceData.supplierVat || invoiceData.supplierVat === "NOT_FOUND_ON_INVOICE" || invoiceData.supplierVat === "Not_Found";

        if (isRegMissing) {
            missingFields.push("Supplier Registration Number");
        }
        
        // Critical Fix: Missing VAT is only an error requiring re-extraction if the vendor actually charged Tax.
        if (isVatMissing && parsedTax > 0) {
            missingFields.push("Supplier VAT Number (Required because Tax > 0)");
        }
    } else {
        console.log(`[Supervisor] 👤 Vendor "${invoiceData.vendorName}" appears to be a private person — skipping VAT/Reg requirement.`);
    }
    
    // 4. Mandatory Item Description
    if (!invoiceData.lineItems || invoiceData.lineItems.length === 0 || !invoiceData.lineItems[0].description || String(invoiceData.lineItems[0].description).trim() === '') {
        missingFields.push("Item Description (lineItems)");
    }

    // Evaluate the psychological state of the Supervisor
    if (missingFields.length > 0) {
        critique = `You missed the following critical fields: ${missingFields.join(', ')}. Please completely re-scan the document, check the extreme margins, small text, and footers. If a field is genuinely absent from the physical document, output "Not_Found" — do NOT invent or deduce numbers from memory, as fabricated registration numbers would corrupt the accounting ledger.`;
        
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
