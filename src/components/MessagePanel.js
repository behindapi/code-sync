import React, { useEffect, useRef, useState } from 'react';

const MAX_MESSAGE_LENGTH = 280;

const MessagePanel = ({ messages, onSend, connected }) => {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const inputRef = useRef(null);
    const toggleRef = useRef(null);
    const listRef = useRef(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open) inputRef.current?.focus();
        else if (wasOpen.current) toggleRef.current?.focus();
        wasOpen.current = open;
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [open]);

    useEffect(() => {
        if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages, open]);

    const submit = (event) => {
        event.preventDefault();
        const cleanText = text.trim();
        if (!cleanText || cleanText.length > MAX_MESSAGE_LENGTH || !connected) return;
        onSend(cleanText);
        setText('');
    };

    return (
        <aside className={`message-dock ${open ? 'is-open' : ''}`} aria-label="Room messages">
            {open && (
                <section id="message-panel" className="message-panel" aria-labelledby="message-title">
                    <header className="message-panel-header">
                        <div><h2 id="message-title">Room messages</h2><p>Only current participants can see these.</p></div>
                        <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close messages">×</button>
                    </header>
                    <div className="message-list" ref={listRef} aria-live="polite" aria-relevant="additions text">
                        {messages.length === 0 ? (
                            <p className="message-empty">No messages yet. Use this space for a quick note.</p>
                        ) : messages.map((message) => (
                            <article className="room-message" key={message.messageId}>
                                <div><strong>{message.displayName}</strong><time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                                <p>{message.text}</p>
                            </article>
                        ))}
                    </div>
                    <form className="message-compose" onSubmit={submit}>
                        <label className="sr-only" htmlFor="room-message">Message participants</label>
                        <input
                            id="room-message"
                            ref={inputRef}
                            type="text"
                            maxLength={MAX_MESSAGE_LENGTH}
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            placeholder="Send a short message"
                            disabled={!connected}
                        />
                        <button className="message-send" type="submit" disabled={!connected || !text.trim()} aria-label="Send message">Send</button>
                    </form>
                    <p className="message-retention-note">Messages are not saved; only connected participants receive them.</p>
                </section>
            )}
            <button ref={toggleRef} className="message-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="message-panel">
                <span aria-hidden="true" className="message-icon">···</span>
                <span>{open ? 'Close messages' : 'Messages'}</span>
                {messages.length > 0 && <span className="message-count" aria-label={`${messages.length} messages`}>{Math.min(messages.length, 99)}</span>}
            </button>
        </aside>
    );
};

export default MessagePanel;
