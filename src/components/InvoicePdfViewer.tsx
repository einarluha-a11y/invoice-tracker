import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
    url: string;
    onClose: () => void;
}

export function InvoicePdfViewer({ url, onClose }: PdfViewerProps) {
    const [numPages, setNumPages] = useState<number>();
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [isLoading, setIsLoading] = useState(true);

    function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
        setNumPages(numPages);
        setIsLoading(false);
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(5px)'
        }}>
            <div style={{ width: '100%', maxWidth: '1000px', display: 'flex', justifyContent: 'space-between', padding: '1rem', alignItems: 'center' }}>
                <div style={{ color: 'white', display: 'flex', gap: '1rem' }}>
                    <button
                        onClick={() => setPageNumber(prev => Math.max(prev - 1, 1))}
                        disabled={pageNumber <= 1}
                        style={{ padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #555', background: '#333', color: 'white', cursor: pageNumber <= 1 ? 'not-allowed' : 'pointer' }}
                    >
                        Prev
                    </button>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        Page {pageNumber} of {numPages || '--'}
                    </span>
                    <button
                        onClick={() => setPageNumber(prev => Math.min(prev + 1, numPages || 1))}
                        disabled={pageNumber >= (numPages || 1)}
                        style={{ padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #555', background: '#333', color: 'white', cursor: pageNumber >= (numPages || 1) ? 'not-allowed' : 'pointer' }}
                    >
                        Next
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <a
                        href={url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        style={{ background: 'var(--accent-color, #3b82f6)', border: 'none', color: '#fff', borderRadius: '4px', padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    >
                        Download PDF
                    </a>
                    <button
                        onClick={onClose}
                        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '50%', width: '40px', height: '40px', fontSize: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Close Viewer"
                    >
                        &times;
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', width: '100%', display: 'flex', justifyContent: 'center', paddingBottom: '2rem' }}>
                <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                    <Document
                        file={url}
                        onLoadSuccess={onDocumentLoadSuccess}
                        loading={<div style={{ padding: '3rem', color: '#666' }}>Loading PDF...</div>}
                        error={<div style={{ padding: '3rem', color: 'red' }}>Failed to load PDF. Cross-Origin (CORS) or Invalid File.</div>}
                    >
                        <Page
                            pageNumber={pageNumber}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                            width={Math.min(window.innerWidth * 0.9, 900)}
                        />
                    </Document>
                </div>
            </div>
        </div>
    );
}
