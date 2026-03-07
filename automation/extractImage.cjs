const { PDFDocument, PDFName, PDFDict, PDFStream } = require('pdf-lib');
const fs = require('fs');

async function debugPDF() {
    const pdfBytes = fs.readFileSync('ingeen_test.pdf');
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    const context = doc.context;
    const indirectObjects = context.enumerateIndirectObjects();

    let foundImage = false;
    for (const [ref, obj] of indirectObjects) {
        if (obj instanceof PDFStream) {
            const dict = obj.dict;
            if (dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
                foundImage = true;
                const filter = dict.get(PDFName.of('Filter'));
                console.log(`Found Image! Filter:`, filter ? filter.toString() : 'None');
                console.log(`Width:`, dict.get(PDFName.of('Width')));
                console.log(`Height:`, dict.get(PDFName.of('Height')));

                // Print the raw length
                console.log(`Buffer size: ${obj.contents.length} bytes`);

                // If it is DCTDecode (JPEG), just write it as JPEG
                if (filter && filter.toString() === '/DCTDecode') {
                    fs.writeFileSync('ingeen_extracted.jpg', obj.contents);
                    console.log("Saved ingeen_extracted.jpg");
                }
            }
        }
    }

    if (!foundImage) console.log("No embedded image streams found inside the PDF.");
}
debugPDF().catch(console.error);
