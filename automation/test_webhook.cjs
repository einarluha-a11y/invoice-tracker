async function testZapier() {
    console.log("Simulating Zapier sending a file to the Invoice Intelligence Backend...");
    
    // An example public PDF or existing firebase URL for testing
    // Using a known invoice PDF URL from this project's history if possible, or just a dummy one
    const payload = {
        // Here we just use an existing file we know exists in the bucket
        fileUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        fileName: "zapier_test_invoice.pdf",
        companyId: "bP6dc0PMdFtnmS5QTX4N" // Global Technics
    };

    try {
        const response = await fetch('http://localhost:8080/api/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log("\n--- INTAKE RESPONSE ---");
        console.log(JSON.stringify(data, null, 2));

    } catch (e) {
        console.error("Test failed:", e.message);
    }
}

testZapier();
