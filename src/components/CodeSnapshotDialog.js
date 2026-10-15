import React, { useEffect, useRef, useState } from 'react';
import CodeMirror from 'codemirror';
import { toBlob } from 'html-to-image';
import 'codemirror/lib/codemirror.css';
import { getLanguage } from '../editorPreferences';

const CARD_THEMES = [
    { id: 'midnight', label: 'Midnight' },
    { id: 'paper', label: 'Paper' },
    { id: 'graphite', label: 'Graphite' },
];

const CodeSnapshotDialog = ({ code, language, editorTheme, onClose }) => {
    const previewRef = useRef(null);
    const codeMirrorRef = useRef(null);
    const closeRef = useRef(null);
    const [cardTheme, setCardTheme] = useState('midnight');
    const [status, setStatus] = useState('');

    useEffect(() => {
        const previousFocus = document.activeElement;
        closeRef.current?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab') return;
            const focusable = Array.from(document.querySelectorAll('.snapshot-dialog button, .snapshot-dialog select')).filter((element) => !element.disabled);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            previousFocus?.focus?.();
        };
    }, [onClose]);

    useEffect(() => {
        const textarea = document.getElementById('snapshot-code');
        const editor = CodeMirror.fromTextArea(textarea, {
            mode: getLanguage(language).mode,
            theme: cardTheme === 'paper' ? 'eclipse' : editorTheme,
            readOnly: true,
            lineNumbers: false,
            lineWrapping: true,
            cursorBlinkRate: -1,
            viewportMargin: Infinity,
        });
        codeMirrorRef.current = editor;
        editor.setSize('100%', 'auto');
        return () => {
            editor.toTextArea();
            codeMirrorRef.current = null;
        };
    }, [language, editorTheme, cardTheme]);

    const saveImage = async (copy) => {
        if (!previewRef.current) return;
        setStatus(copy ? 'Preparing image to copy...' : 'Preparing download...');
        try {
            const blob = await toBlob(previewRef.current, { pixelRatio: 2, cacheBust: true });
            if (!blob) throw new Error('The browser could not create an image.');
            if (copy) {
                if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Image copy is not available in this browser.');
                await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
                setStatus('Image copied to clipboard.');
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `code-sync-${language}.png`;
            link.click();
            URL.revokeObjectURL(url);
            setStatus('Image downloaded.');
        } catch (error) {
            setStatus(error.message || 'Could not export this image. Try downloading it instead.');
        }
    };

    return (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="snapshot-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshot-title">
                <header className="dialog-heading">
                    <div><h2 id="snapshot-title">Code snapshot</h2><p>A shareable image of this room’s current code.</p></div>
                    <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close code snapshot">×</button>
                </header>
                <div className="snapshot-controls">
                    <label htmlFor="card-theme">Card theme</label>
                    <select id="card-theme" value={cardTheme} onChange={(event) => setCardTheme(event.target.value)}>
                        {CARD_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                    </select>
                </div>
                <div className="snapshot-preview-wrap">
                    <div className={`code-card card-${cardTheme}`} ref={previewRef}>
                        <div className="code-card-windowbar"><span /><span /><span /><strong>{getLanguage(language).label}</strong><span className="code-card-language">{getLanguage(language).label}</span></div>
                        <div className="code-card-content">
                            <textarea id="snapshot-code" defaultValue={code} aria-label="Code snapshot preview" />
                        </div>
                        <div className="code-card-footer">Code Sync <span>behindapi © 2026</span></div>
                    </div>
                </div>
                <div className="dialog-actions">
                    <button className="secondary-action small-action" type="button" onClick={() => saveImage(true)}>Copy image</button>
                    <button className="primary-action small-action" type="button" onClick={() => saveImage(false)}>Download PNG</button>
                </div>
                <p className="dialog-status" role="status" aria-live="polite">{status}</p>
            </section>
        </div>
    );
};

export default CodeSnapshotDialog;
