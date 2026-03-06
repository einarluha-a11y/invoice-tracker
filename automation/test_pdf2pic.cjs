const fs = require('fs');
const { fromBuffer } = require('pdf2pic');

async function testPdf() {
    console.log("Creating dummy PDF buffer...");
    const dummyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n188\n%%EOF");

    const options = {
        density: 100,
        saveFilename: "temp",
        savePath: "/tmp",
        format: "png",
        width: 100,
        height: 100
    };
    try {
        const convert = fromBuffer(dummyPdf, options);
        const result2 = await convert(1, { responseType: "base64" });
        console.log("Result 2 Object Keys:", Object.keys(result2));
        console.log("Result 2 Has Base64:", !!result2.base64);

        const convertBase64Config = fromBuffer(dummyPdf, { ...options });
        const result3 = await convertBase64Config(1, { responseType: "base64" });
        console.log("Result 3 Has Base64:", !!result3.base64);
        console.log("Result 2 Object Keys:", Object.keys(result2));
        console.log("Result 2 Has Base64:", !!result2.base64);
        console.log("Base64 string portion:", result2.base64 ? result2.base64.substring(0, 30) : undefined);
    } catch (e) {
        console.error(e.message);
    }
}
testPdf();
