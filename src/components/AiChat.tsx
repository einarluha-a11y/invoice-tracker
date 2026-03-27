import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AiChatProps {
    onApplyFilters: (filters: {
        searchTerm?: string;
        status?: string;
        dateFrom?: string;
        dateTo?: string;
    }) => void;
}

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: Date;
}

export function AiChat({ onApplyFilters }: AiChatProps) {
    const { t, i18n } = useTranslation();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            text: t('chat.welcome'),
            sender: 'ai',
            timestamp: new Date()
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Update the welcome message text dynamically if the user changes the language in the header
    useEffect(() => {
        setMessages(prev => {
            const newMessages = [...prev];
            if (newMessages.length > 0 && newMessages[0].id === 'welcome') {
                newMessages[0].text = t('chat.welcome');
            }
            return newMessages;
        });
    }, [i18n.language, t]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const trimmedMsg = inputValue.trim();
        if (!trimmedMsg || isLoading) return;

        const newUserMsg: Message = {
            id: Date.now().toString(),
            text: trimmedMsg,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, newUserMsg]);
        setInputValue('');
        setIsLoading(true);

        try {
            // Define the API URL based on Environment Variables (local vs Zone.eu deployment)
            const env = (import.meta as any).env;
            const apiUrl = env.VITE_API_URL || (env.PROD ? '' : 'http://localhost:3000');
            const res = await fetch(`${apiUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: trimmedMsg })
            });

            if (!res.ok) {
                throw new Error(`Server returned ${res.status}`);
            }

            const data = await res.json();

            // Generate AI response message
            const newAiMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: data.reply || 'Выполнено.',
                sender: 'ai',
                timestamp: new Date()
            };

            setMessages(prev => [...prev, newAiMsg]);

            // Apply filters if they exist
            if (data.filters) {
                onApplyFilters(data.filters);
            }

        } catch (error) {
            console.error('Chat error:', error);
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: t('chat.error'),
                sender: 'ai',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            height: isExpanded ? '350px' : 'auto',
            marginBottom: '2rem',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-md)',
            transition: 'height 0.3s ease'
        }}>
            <div 
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                padding: '1rem',
                borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
                background: 'rgba(22, 27, 34, 0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                userSelect: 'none'
            }}>
                <div style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: 'var(--status-paid-text)',
                    boxShadow: '0 0 8px var(--status-paid-text)'
                }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff', flex: 1 }}>{t('chat.title')}</h3>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ 
                    color: 'var(--text-secondary)',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', 
                    transition: 'transform 0.3s ease' 
                }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>

            {isExpanded && (
                <>
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}>
                {messages.map(msg => (
                    <div key={msg.id} style={{
                        alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem'
                    }}>
                        <div style={{
                            background: msg.sender === 'user' ? 'var(--accent-color)' : 'transparent',
                            color: msg.sender === 'user' ? '#fff' : 'var(--text-secondary)',
                            padding: '0.8rem 1.2rem',
                            borderRadius: '1.2rem',
                            borderBottomRightRadius: msg.sender === 'user' ? '4px' : '1.2rem',
                            borderBottomLeftRadius: msg.sender === 'ai' ? '4px' : '1.2rem',
                            boxShadow: msg.sender === 'user' ? '0 2px 5px rgba(0,0,0,0.1)' : 'none',
                            lineHeight: '1.4',
                            border: 'none',
                            fontSize: msg.sender === 'ai' ? '0.95rem' : '1rem' // Slightly smaller for the muted AI text
                        }}>
                            {msg.text}
                        </div>
                        <span style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                            padding: '0 0.5rem'
                        }}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                ))}

                {isLoading && (
                    <div style={{ alignSelf: 'flex-start', background: 'rgba(255, 255, 255, 0.04)', padding: '0.8rem 1.2rem', borderRadius: '1.2rem', borderBottomLeftRadius: '4px' }}>
                        <span style={{ opacity: 0.6, color: 'rgba(255, 255, 255, 0.85)' }}>{t('chat.typing')}</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', background: 'rgba(22, 27, 34, 0.5)' }}>
                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '0.75rem' }}>
                    <input
                        type="text"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        placeholder={t('chat.placeholder')}
                        style={{
                            flex: 1,
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)',
                            padding: '0.8rem 1.2rem',
                            borderRadius: '2rem',
                            outline: 'none',
                            fontSize: '0.95rem'
                        }}
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={!inputValue.trim() || isLoading}
                        style={{
                            background: inputValue.trim() && !isLoading ? 'var(--accent-color)' : 'var(--border-color)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '50%',
                            width: '45px',
                            height: '45px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: inputValue.trim() && !isLoading ? 'pointer' : 'not-allowed',
                            transition: 'background 0.2s'
                        }}
                        title="Отправить"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </form>
            </div>
            </>
            )}
        </div>
    );
}
