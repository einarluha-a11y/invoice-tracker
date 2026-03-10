import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker locally from installed package to avoid unpkg blocks
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
).toString();

interface InvoicePdfViewerProps {
    url: string;
}

export const InvoicePdfViewer: React.FC<InvoicePdfViewerProps> = ({ url }) => {
    const [numPages, setNumPages] = useState<number>();
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [error, setError] = useState<string | null>(null);
    const [pdfFile, setPdfFile] = useState<Blob | string | null>(null);

    useEffect(() => {
        let active = true;

        const loadPdf = async () => {
            try {
                // Fetch safely through our local Vercel serverless proxy endpoint to bypass Firebase CORS natively
                const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);

                if (!response.ok) throw new Error('Failed to load document via local proxy.');

                const blob = await response.blob();
                if (active) {
                    setPdfFile(blob);
                }
            } catch (err) {
                console.error('Failed to fetch PDF blob:', err);
                if (active) {
                    setError('Failed to download PDF data.');
                }
            }
        };

        loadPdf();

        return () => { active = false; };
    }, [url]);

    function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
        setNumPages(numPages);
        setError(null);
    }

    function onDocumentLoadError(error: Error) {
        console.error('PDF load error:', error);
        setError(error.message);
    }

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#f5f5f5', overflow: 'auto', padding: '20px', borderRadius: 'var(--radius-lg)' }}>
            {error ? (
                <div style={{ color: 'red', padding: '20px', textAlign: 'center' }}>
                    <p>Failed to load PDF: {error}</p>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}>
                        Click here to download/open the file directly
                    </a>
                </div>
            ) : pdfFile ? (
                <>
                    <Document
                        file={pdfFile}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={
                            <div style={{ color: '#666', fontSize: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
                                <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(0,0,0,0.1)', borderTop: '3px solid var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                Loading PDF Document...
                                <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                            </div>
                        }
                    >
                        <Page
                            pageNumber={pageNumber}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            width={Math.min(window.innerWidth * 0.85, 900)}
                        />
                    </Document>

                    {numPages && numPages > 1 && (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '1rem', padding: '10px', background: 'white', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
                            <button
                                onClick={() => setPageNumber(prev => Math.max(prev - 1, 1))}
                                disabled={pageNumber <= 1}
                                style={{ padding: '5px 10px', cursor: pageNumber <= 1 ? 'not-allowed' : 'pointer', borderRadius: '4px', border: '1px solid #ccc', background: pageNumber <= 1 ? '#eee' : '#fff' }}
                            >
                                Previous
                            </button>
                            <span>Page {pageNumber} of {numPages}</span>
                            <button
                                onClick={() => setPageNumber(prev => Math.min(prev + 1, numPages))}
                                disabled={pageNumber >= numPages}
                                style={{ padding: '5px 10px', cursor: pageNumber >= numPages ? 'not-allowed' : 'pointer', borderRadius: '4px', border: '1px solid #ccc', background: pageNumber >= numPages ? '#eee' : '#fff' }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div style={{ color: '#666', fontSize: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
                    <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(0,0,0,0.1)', borderTop: '3px solid var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Downloading Secure PDF Data...
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
        </div>
    );
};
