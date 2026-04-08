import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize PDF.js worker locally using Vite's ?url syntax
// @ts-expect-error - Vite specific import suffix
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface InvoicePdfViewerProps {
    url: string;
}

export const InvoicePdfViewer: React.FC<InvoicePdfViewerProps> = ({ url }) => {
    const [numPages, setNumPages] = useState<number>();
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [error, setError] = useState<string | null>(null);
    const [fileData, setFileData] = useState<{ blob: Blob; isImage: boolean } | null>(null);
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        const loadFile = async () => {
            try {
                // Get Firebase Auth token for authenticated requests
                const auth = getAuth();
                const token = await auth.currentUser?.getIdToken();
                const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

                // Strategy: try direct Firebase URL first (instant), fall back to proxy if CORS blocks
                let response: Response;
                try {
                    response = await fetch(url, { mode: 'cors', headers });
                    if (!response.ok) throw new Error('direct-failed');
                } catch {
                    // CORS or network error — use backend proxy
                    const apiBase = import.meta.env.VITE_API_URL || '';
                    const proxyUrl = `${apiBase}/api/pdf-proxy?url=${encodeURIComponent(url)}`;
                    response = await fetch(proxyUrl, { headers });
                }

                if (!response.ok) throw new Error(`Failed to download file (${response.status}).`);

                const contentType = response.headers.get('content-type') || '';
                const blob = await response.blob();

                if (!active) return;

                const isImage = contentType.startsWith('image/') ||
                    /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(url);

                setFileData({ blob, isImage });

                if (isImage) {
                    const objectUrl = URL.createObjectURL(blob);
                    setImageSrc(objectUrl);
                }
            } catch (err) {
                console.error('Failed to fetch file:', err);
                if (active) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            }
        };

        loadFile();

        return () => {
            active = false;
            // Clean up blob URL when component unmounts or url changes
            if (imageSrc) URL.revokeObjectURL(imageSrc);
        };
    }, [url]);

    function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
        setNumPages(numPages);
        setError(null);
    }

    function onDocumentLoadError(error: Error) {
        console.error('PDF load error:', error);
        setError(error.message);
    }

    const spinner = (label: string) => (
        <div style={{ color: '#666', fontSize: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
            <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(0,0,0,0.1)', borderTop: '3px solid var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            {label}
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#f5f5f5', overflow: 'auto', padding: '20px', borderRadius: 'var(--radius-lg)' }}>
            {error ? (
                <div style={{ color: 'red', padding: '20px', textAlign: 'center' }}>
                    <p>Failed to load file: {error}</p>
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}>
                        Click here to open the file directly
                    </a>
                </div>
            ) : !fileData ? (
                spinner('Downloading Secure File...')
            ) : fileData.isImage ? (
                imageSrc ? (
                    <img
                        src={imageSrc}
                        alt="Invoice Document"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 'var(--radius-lg)' }}
                    />
                ) : (
                    spinner('Rendering Image...')
                )
            ) : (
                <>
                    <Document
                        file={fileData.blob}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={spinner('Loading PDF Document...')}
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
            )}
        </div>
    );
};
