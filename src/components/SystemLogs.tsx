import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useTranslation } from 'react-i18next';

interface LogEntry {
    id: string;
    errorCode: string;
    context: string;
    message: string;
    timestamp: string;
}

interface SystemLogsProps {
    onBack: () => void;
}

export function SystemLogs({ onBack }: SystemLogsProps) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            if (!db) throw new Error("Database not initialized");
            // Native single-field sorting is fully supported bypasses composite index requirements!
            const q = query(
                collection(db, 'system_logs'),
                orderBy('createdAt', 'desc'),
                limit(100)
            );
            const snapshot = await getDocs(q);
            const fetched = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as LogEntry[];
            setLogs(fetched);
        } catch (error) {
            console.error("Failed to fetch system logs:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div className="dashboard-container" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)',
                            padding: '0.4rem 0.8rem',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                        }}
                    >
                        {t('settingsPage.back') || 'Назад'}
                    </button>
                    <h2>Системный Журнал (DLQ)</h2>
                </div>
                <button onClick={fetchLogs} style={{
                    background: 'var(--header-accent)',
                    color: '#fff',
                    border: 'none',
                    padding: '0.6rem 1.2rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer'
                }}>
                    Обновить
                </button>
            </div>

            <div className="table-container" style={{ padding: '2rem' }}>
                {loading ? (
                    <div className="loader">Загрузка логов...</div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '4rem', display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-secondary)' }}>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1.5rem', opacity: 0.5 }}>
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <h3 style={{ margin: 0, fontWeight: 500, color: '#fff' }}>Ошибок не обнаружено</h3>
                        <p style={{ marginTop: '0.5rem', opacity: 0.8 }}>Бэкенд-сервис и модули ИИ работают стабильно.</p>
                    </div>
                ) : (
                    <table className="invoice-table">
                        <thead>
                            <tr>
                                <th>Время</th>
                                <th>Код Ошибки</th>
                                <th>Контекст (Email/ID)</th>
                                <th>Описание (Message)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => (
                                <tr key={log.id}>
                                    <td style={{ whiteSpace: 'nowrap', width: '15%' }}>
                                        {new Date(log.timestamp).toLocaleString()}
                                    </td>
                                    <td style={{ width: '20%' }}>
                                        <span style={{
                                            background: 'rgba(235, 87, 87, 0.15)',
                                            color: '#ff6b6b',
                                            padding: '0.3rem 0.8rem',
                                            borderRadius: '20px',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            display: 'inline-block'
                                        }}>
                                            {log.errorCode}
                                        </span>
                                    </td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '0.9rem', width: '25%' }}>{log.context}</td>
                                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
