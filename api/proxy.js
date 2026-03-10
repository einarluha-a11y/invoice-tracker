export default async function handler(req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch from external URL: ${response.status}`);
        }

        // Ensure content type is explicitly application/pdf for PDFs and add inline disposition
        let contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (url.toLowerCase().includes('.pdf')) {
            contentType = 'application/pdf';
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline; filename="invoice.pdf"');

        // Set CORS headers for our proxy
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Convert the readable stream from fetch to an ArrayBuffer, then a Buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.status(200).send(buffer);
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
}
