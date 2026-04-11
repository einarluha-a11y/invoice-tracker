/**
 * Public share link landing page (sprint 5 viral loop).
 *
 * Accessed via /share/<token> — no Firebase auth. Flow:
 *   1. On mount, fetch /api/share/:token/info to get label + remainingUploads
 *   2. Show drag-and-drop file picker
 *   3. On drop/select, POST raw file bytes to /api/share/:token/upload
 *   4. Show success state with "Powered by Invoice Tracker — Sign up free"
 *      CTA that seeds the viral loop.
 *
 * Error states: expired / revoked / invalid / cap reached → show a polite
 * message with the "Sign up" CTA so bad links still convert.
 *
 * Routing: currently dispatched from main.tsx based on window.location
 * (no react-router in this project). The entire component is self-
 * contained — it doesn't touch AuthContext because there's no user.
 */

import React, { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface LinkInfo {
    label: string;
    remainingUploads: number;
    expiresAt: number;
}

type UploadState =
    | { kind: 'idle' }
    | { kind: 'uploading'; name: string }
    | { kind: 'success'; invoiceCount: number; remaining: number }
    | { kind: 'error'; message: string };

export const ShareLandingPage: React.FC<{ token: string }> = ({ token }) => {
    const [info, setInfo] = useState<LinkInfo | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
    const [dragOver, setDragOver] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`${API_BASE}/api/share/${encodeURIComponent(token)}/info`)
            .then(async (r) => {
                const data = await r.json();
                if (cancelled) return;
                if (r.ok) setInfo(data);
                else setLinkError(data.error || 'Link unavailable');
            })
            .catch(() => {
                if (!cancelled) setLinkError('Could not reach the server');
            });
        return () => { cancelled = true; };
    }, [token]);

    async function handleFile(file: File) {
        if (!file) return;
        const MAX = 25 * 1024 * 1024;
        if (file.size > MAX) {
            setUpload({ kind: 'error', message: `File too large (max 25 MB)` });
            return;
        }
        setUpload({ kind: 'uploading', name: file.name });
        try {
            const buffer = await file.arrayBuffer();
            const r = await fetch(`${API_BASE}/api/share/${encodeURIComponent(token)}/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': file.type || 'application/pdf',
                    'X-File-Name': file.name,
                    'X-Content-Type': file.type || 'application/pdf',
                },
                body: buffer,
            });
            const data = await r.json();
            if (!r.ok) {
                setUpload({ kind: 'error', message: data.error || 'Upload failed' });
                return;
            }
            setUpload({
                kind: 'success',
                invoiceCount: data.invoiceCount || 1,
                remaining: data.remainingUploads ?? 0,
            });
            // Refresh info block so remaining count matches
            setInfo((prev) =>
                prev ? { ...prev, remainingUploads: data.remainingUploads ?? prev.remainingUploads } : prev
            );
        } catch (err: any) {
            setUpload({ kind: 'error', message: err?.message || 'Upload failed' });
        }
    }

    function onDrop(e: React.DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'var(--bg-color, #0e0f1a)',
                color: 'var(--text-primary, #e5e7f0)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            <div style={{ maxWidth: '520px', width: '100%', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📄</div>
                <h1 style={{ margin: '0 0 0.3rem 0', fontSize: '1.8rem' }}>
                    Upload your invoice
                </h1>
                {info && info.label && (
                    <p style={{ color: 'var(--text-secondary, #8a8fa3)', marginTop: 0 }}>
                        for <strong>{info.label}</strong>
                    </p>
                )}

                {linkError ? (
                    <ErrorBlock message={linkError} />
                ) : !info ? (
                    <div style={{ padding: '2rem', color: 'var(--text-secondary, #8a8fa3)' }}>
                        Loading link…
                    </div>
                ) : upload.kind === 'success' ? (
                    <SuccessBlock count={upload.invoiceCount} />
                ) : (
                    <UploadBlock
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        onDrop={onDrop}
                        onFile={handleFile}
                        state={upload}
                        remaining={info.remainingUploads}
                    />
                )}

                <Footer />
            </div>
        </div>
    );
};

function UploadBlock({
    dragOver,
    setDragOver,
    onDrop,
    onFile,
    state,
    remaining,
}: {
    dragOver: boolean;
    setDragOver: (v: boolean) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
    onFile: (f: File) => void;
    state: UploadState;
    remaining: number;
}) {
    return (
        <>
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                style={{
                    border: `2px dashed ${dragOver ? '#4a9eff' : '#3a3d54'}`,
                    borderRadius: '12px',
                    padding: '2.5rem 1.5rem',
                    background: dragOver ? 'rgba(74, 158, 255, 0.06)' : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.15s',
                    marginTop: '1.5rem',
                    cursor: 'pointer',
                }}
                onClick={() => document.getElementById('share-file-input')?.click()}
            >
                {state.kind === 'uploading' ? (
                    <div style={{ fontSize: '1rem' }}>
                        Uploading <strong>{state.name}</strong>…
                    </div>
                ) : state.kind === 'error' ? (
                    <div>
                        <div style={{ color: '#ff6b6b', marginBottom: '0.5rem' }}>
                            {state.message}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#8a8fa3' }}>
                            Click or drag another file to retry
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: '2rem', marginBottom: '0.6rem' }}>⬆</div>
                        <div style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>
                            Drop a PDF here or click to choose
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#8a8fa3' }}>
                            PDF, JPG, PNG · up to 25 MB
                        </div>
                    </>
                )}
                <input
                    id="share-file-input"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onFile(f);
                    }}
                />
            </div>
            <div style={{ fontSize: '0.8rem', color: '#8a8fa3', marginTop: '0.8rem' }}>
                {remaining} upload{remaining === 1 ? '' : 's'} remaining on this link
            </div>
        </>
    );
}

function SuccessBlock({ count }: { count: number }) {
    return (
        <div
            style={{
                border: '1px solid rgba(74, 255, 122, 0.3)',
                borderRadius: '12px',
                padding: '2rem 1.5rem',
                background: 'rgba(74, 255, 122, 0.04)',
                marginTop: '1.5rem',
            }}
        >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                Received — thank you
            </div>
            <div style={{ fontSize: '0.9rem', color: '#8a8fa3', marginTop: '0.4rem' }}>
                {count === 1
                    ? 'Your invoice is now in their Invoice Tracker.'
                    : `${count} invoices extracted and delivered.`}
            </div>
            <a
                href="/"
                style={{
                    display: 'inline-block',
                    marginTop: '1.2rem',
                    padding: '0.7rem 1.4rem',
                    borderRadius: '8px',
                    background: '#4a9eff',
                    color: 'white',
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                }}
            >
                Track your own invoices free →
            </a>
        </div>
    );
}

function ErrorBlock({ message }: { message: string }) {
    return (
        <div
            style={{
                border: '1px solid rgba(255, 107, 107, 0.4)',
                borderRadius: '12px',
                padding: '2rem 1.5rem',
                background: 'rgba(255, 107, 107, 0.04)',
                marginTop: '1.5rem',
            }}
        >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                {message}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#8a8fa3' }}>
                The person who sent you this link may have revoked it or it has expired.
            </div>
            <a
                href="/"
                style={{
                    display: 'inline-block',
                    marginTop: '1rem',
                    padding: '0.6rem 1.2rem',
                    borderRadius: '8px',
                    background: '#4a9eff',
                    color: 'white',
                    textDecoration: 'none',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                }}
            >
                Try Invoice Tracker free →
            </a>
        </div>
    );
}

function Footer() {
    return (
        <div
            style={{
                marginTop: '2rem',
                fontSize: '0.75rem',
                color: '#6b7084',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: '1.5rem',
            }}
        >
            Powered by <strong style={{ color: '#8a8fa3' }}>Invoice Tracker</strong>
            {' — '}
            <a href="/" style={{ color: '#4a9eff', textDecoration: 'none' }}>
                Sign up free
            </a>
        </div>
    );
}

export default ShareLandingPage;
