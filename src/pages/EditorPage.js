import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import * as Y from 'yjs';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import CodeSnapshotDialog from '../components/CodeSnapshotDialog';
import Editor from '../components/Editor';
import MessagePanel from '../components/MessagePanel';
import SandboxRunner from '../components/SandboxRunner';
import { canFormat, formatCode } from '../formatCode';
import { getLanguage, LANGUAGE_OPTIONS, EDITOR_THEMES, loadEditorPreferences, saveEditorPreferences } from '../editorPreferences';
import { initSocket } from '../socket';
import './RoomPage.css';

const REMOTE_ORIGIN = 'room-snapshot';

function asUpdate(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return new Uint8Array(value);
    return new Uint8Array(value || []);
}

const EditorPage = () => {
    const { roomId: routeRoomId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const [doc] = useState(() => new Y.Doc());
    const [currentRoomId, setCurrentRoomId] = useState(routeRoomId === 'new' ? '' : routeRoomId);
    const [participants, setParticipants] = useState([]);
    const [messages, setMessages] = useState([]);
    const [connectionStatus, setConnectionStatus] = useState('connecting');
    const [roomError, setRoomError] = useState('');
    const [preferences, setPreferences] = useState(loadEditorPreferences);
    const [formatStatus, setFormatStatus] = useState('');
    const [isFormatting, setIsFormatting] = useState(false);
    const [snapshotOpen, setSnapshotOpen] = useState(false);
    const [output, setOutput] = useState({ status: 'idle', lines: [] });
    const [runRequest, setRunRequest] = useState(null);
    const [cursorPosition, setCursorPosition] = useState('Ln 1, Col 1');
    const socketRef = useRef(null);
    const editorApiRef = useRef(null);
    const roomIdRef = useRef(routeRoomId === 'new' ? '' : routeRoomId);
    const createRequestedRef = useRef(routeRoomId === 'new');
    const joinedRef = useRef(false);
    const displayNameRef = useRef(location.state?.displayName || '');

    const onEditorReady = useCallback((api) => {
        editorApiRef.current = api;
        if (api) {
            api.editor.on('cursorActivity', (editor) => {
                const cursor = editor.getCursor();
                setCursorPosition(`Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`);
            });
        }
    }, []);

    useEffect(() => {
        const socket = initSocket();
        socketRef.current = socket;

        const onDocumentUpdate = ({ update } = {}) => {
            try {
                Y.applyUpdate(doc, asUpdate(update), REMOTE_ORIGIN);
            } catch (_error) {
                toast.error('A shared code update could not be applied.');
            }
        };
        const onPresence = ({ participants: roomParticipants } = {}) => setParticipants(Array.isArray(roomParticipants) ? roomParticipants : []);
        const onMessage = (message) => setMessages((previous) => [...previous, message].slice(-40));
        const onRoomError = ({ message } = {}) => {
            if (message) toast.error(message);
        };
        const onConnectError = () => {
            setConnectionStatus('reconnecting');
            setRoomError('The room service is unreachable. Reconnecting now.');
        };
        const onDisconnect = () => {
            joinedRef.current = false;
            setMessages([]);
            setConnectionStatus('reconnecting');
        };

        const finishJoin = (result) => {
            if (!result || !result.ok) {
                setConnectionStatus('error');
                setRoomError(result?.message || 'Could not open this room.');
                return;
            }
            roomIdRef.current = result.roomId;
            setCurrentRoomId(result.roomId);
            joinedRef.current = true;
            setRoomError('');
            setConnectionStatus('connected');
            setParticipants(result.participants || []);
            Y.applyUpdate(doc, asUpdate(result.snapshot), REMOTE_ORIGIN);
            const localChangesMissingOnServer = Y.encodeStateAsUpdate(doc, asUpdate(result.stateVector));
            socket.emit(ACTIONS.DOCUMENT_UPDATE, { update: localChangesMissingOnServer });
            if (createRequestedRef.current) {
                createRequestedRef.current = false;
                navigate(`/editor/${result.roomId}`, { replace: true, state: null });
                toast.success('Your room is ready. Copy the invite link to collaborate.');
            }
        };

        const onConnect = () => {
            setConnectionStatus('connecting');
            setRoomError('');
            const createRoom = createRequestedRef.current && !roomIdRef.current;
            const eventName = createRoom ? ACTIONS.CREATE : ACTIONS.JOIN;
            const payload = createRoom
                ? { displayName: displayNameRef.current }
                : { roomId: roomIdRef.current || routeRoomId, displayName: displayNameRef.current };
            socket.emit(eventName, payload, finishJoin);
        };

        const onLocalDocumentUpdate = (update, origin) => {
            if (origin === REMOTE_ORIGIN || !joinedRef.current || !socket.connected) return;
            socket.emit(ACTIONS.DOCUMENT_UPDATE, { update });
        };

        doc.on('update', onLocalDocumentUpdate);
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('connect_error', onConnectError);
        socket.on(ACTIONS.DOCUMENT_UPDATE, onDocumentUpdate);
        socket.on(ACTIONS.PRESENCE, onPresence);
        socket.on(ACTIONS.MESSAGE_NEW, onMessage);
        socket.on(ACTIONS.ERROR, onRoomError);

        return () => {
            doc.off('update', onLocalDocumentUpdate);
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('connect_error', onConnectError);
            socket.off(ACTIONS.DOCUMENT_UPDATE, onDocumentUpdate);
            socket.off(ACTIONS.PRESENCE, onPresence);
            socket.off(ACTIONS.MESSAGE_NEW, onMessage);
            socket.off(ACTIONS.ERROR, onRoomError);
            if (socket.connected) socket.emit(ACTIONS.LEAVE);
            socket.disconnect();
            doc.destroy();
            socketRef.current = null;
        };
        // A page instance owns one room session and one Y.Doc. The route can change from /new to its assigned ID.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const updatePreference = (key, value) => {
        setPreferences((previous) => {
            const next = { ...previous, [key]: value };
            saveEditorPreferences(next);
            return next;
        });
    };

    const handleFormat = useCallback(async () => {
        const editor = editorApiRef.current?.editor;
        if (!editor) return;
        if (!canFormat(preferences.language)) {
            setFormatStatus('Formatting is available for JavaScript, JSON, CSS, and HTML.');
            return;
        }
        const source = editor.getValue();
        const cursor = editor.getCursor();
        const scroll = editor.getScrollInfo();
        setIsFormatting(true);
        setFormatStatus('Formatting in this browser...');
        try {
            const formatted = await formatCode(source, preferences.language);
            if (editor.getValue() !== source) {
                setFormatStatus('The shared code changed during formatting. Try again.');
                return;
            }
            const lineCount = Math.max(1, editor.lineCount());
            editor.operation(() => {
                editor.setValue(formatted);
                editor.setCursor({ line: Math.min(cursor.line, lineCount - 1), ch: cursor.ch });
                editor.scrollTo(scroll.left, scroll.top);
            });
            setFormatStatus('Formatting complete.');
        } catch (error) {
            setFormatStatus(error.message || 'Formatting failed. Check the code and try again.');
        } finally {
            setIsFormatting(false);
        }
    }, [preferences.language]);

    const onRunnerOutput = useCallback((result) => setOutput(result), []);

    const runCode = () => {
        const language = getLanguage(preferences.language);
        if (!language.runnable) {
            setOutput({ status: 'unsupported', lines: [{ type: 'note', text: `${language.label} syntax is supported, but browser execution is currently available only for JavaScript.` }] });
            return;
        }
        const code = editorApiRef.current?.editor.getValue() || '';
        setRunRequest({ id: Date.now(), code });
    };

    const copyInviteLink = async () => {
        const inviteLink = `${window.location.origin}/editor/${currentRoomId}`;
        try {
            await navigator.clipboard.writeText(inviteLink);
            toast.success('Invite link copied. Anyone with it can edit this room.');
        } catch (_error) {
            toast.error('Clipboard access is unavailable. Copy the room link from the address bar.');
        }
    };

    const leaveRoom = () => navigate('/');
    const sendMessage = (text) => socketRef.current?.emit(ACTIONS.MESSAGE_SEND, { text });
    const language = getLanguage(preferences.language);

    if (connectionStatus === 'error') {
        return (
            <main className="room-error-page" data-appearance={preferences.appearance}>
                <section className="room-error-panel" role="alert">
                    <span className="room-error-brand">Code Sync</span>
                    <h1>Unable to open this room</h1>
                    <p>{roomError}</p>
                    <div className="room-error-actions">
                        <button className="primary-action" type="button" onClick={leaveRoom}>Back to Code Sync</button>
                        <button className="secondary-action" type="button" onClick={() => window.location.reload()}>Try again</button>
                    </div>
                    <span className="owner-credit">behindapi © 2026</span>
                </section>
            </main>
        );
    }

    return (
        <main className="workspace" data-appearance={preferences.appearance}>
            <header className="workspace-header">
                <a className="workspace-brand" href="/" aria-label="Return to Code Sync">Code Sync</a>
                <div className="room-share-area">
                    <span className="room-id-label">ROOM</span>
                    <code className="room-id-text">{currentRoomId || 'Creating room'}</code>
                    <button type="button" className="subtle-button invite-button" onClick={copyInviteLink} disabled={!currentRoomId}>Copy invite</button>
                </div>
                <div className="participant-strip" aria-label={`${participants.length} participants in this room`}>
                    {participants.slice(0, 4).map((participant) => <Client key={participant.socketId} username={participant.displayName} compact />)}
                    {participants.length > 4 && <span className="participant-overflow">+{participants.length - 4}</span>}
                    <span className={`connection-indicator ${connectionStatus}`}><i />{connectionStatus === 'connected' ? 'Connected' : 'Reconnecting'}</span>
                </div>
                <button type="button" className="leave-button" onClick={leaveRoom}>Leave room</button>
            </header>

            {roomError && <div className="connection-banner" role="status">{roomError}</div>}

            <section className="editor-toolbar" aria-label="Editor controls">
                <div className="toolbar-group language-group">
                    <label htmlFor="language-select">Language</label>
                    <select id="language-select" value={preferences.language} onChange={(event) => updatePreference('language', event.target.value)}>
                        {LANGUAGE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                </div>
                <div className="toolbar-group">
                    <label htmlFor="editor-theme-select">Editor theme</label>
                    <select id="editor-theme-select" value={preferences.editorTheme} onChange={(event) => updatePreference('editorTheme', event.target.value)}>
                        {EDITOR_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                    </select>
                </div>
                <div className="toolbar-spacer" />
                <button className="toolbar-button toolbar-icon-button" type="button" onClick={handleFormat} disabled={isFormatting} aria-label={isFormatting ? 'Formatting code' : 'Format code'} aria-busy={isFormatting} title="Format code (Shift + Option/Alt + F)">
                    <svg className="toolbar-glyph format-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.75h8l4 4v5.1"/><path d="M14 3.75v4h4M8 10h6M8 13h4"/><path d="m13.8 18.9 5.3-5.3a1.5 1.5 0 0 1 2.1 2.1l-5.3 5.3-3 .8.9-2.9Z"/></svg>
                </button>
                <button className="toolbar-button toolbar-icon-button" type="button" onClick={() => setSnapshotOpen(true)} aria-label="Create code snapshot" title="Create code snapshot">
                    <svg className="toolbar-glyph camera-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8.2 6.5 9.5 4.8h5l1.3 1.7h3.1a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.1a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.1Z"/><circle cx="12" cy="12.8" r="3.2"/></svg>
                </button>
                <details className="preferences-menu">
                    <summary className="toolbar-icon-button" aria-label="Preferences" title="Preferences"><svg className="toolbar-glyph settings-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="6.8"/><circle cx="12" cy="12" r="2.7"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6m10.4 10.4 1.6 1.6m0-13.6-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg></summary>
                    <div className="preferences-popover">
                        <label htmlFor="appearance-select">Workspace appearance</label>
                        <select id="appearance-select" value={preferences.appearance} onChange={(event) => updatePreference('appearance', event.target.value)}>
                            <option value="dark">Dark</option><option value="light">Light</option>
                        </select>
                        <label htmlFor="font-size-select">Editor text size</label>
                        <select id="font-size-select" value={preferences.fontSize} onChange={(event) => updatePreference('fontSize', Number(event.target.value))}>
                            {[13, 14, 15, 16, 18].map((size) => <option key={size} value={size}>{size}px</option>)}
                        </select>
                        <label htmlFor="tab-size-select">Indent size</label>
                        <select id="tab-size-select" value={preferences.tabSize} onChange={(event) => updatePreference('tabSize', Number(event.target.value))}>
                            <option value={2}>2 spaces</option><option value={4}>4 spaces</option>
                        </select>
                        <label className="wrap-setting"><input type="checkbox" checked={preferences.lineWrapping} onChange={(event) => updatePreference('lineWrapping', event.target.checked)} /> Wrap long lines</label>
                    </div>
                </details>
                <button className="toolbar-button run-button" type="button" onClick={() => { setOutput({ status: 'idle', lines: [] }); runCode(); }} aria-label="Run code" title="Run JavaScript in an isolated browser worker">Run <span aria-hidden="true">▶</span></button>
            </section>

            <p className={`editor-feedback ${formatStatus ? 'is-visible' : ''}`} role="status" aria-live="polite">{formatStatus}</p>

            <section className="editor-shell" aria-label="Shared editor workspace">
                <div className="editor-stage">
                    {doc && <Editor
                        doc={doc}
                        language={preferences.language}
                        editorTheme={preferences.editorTheme}
                        tabSize={preferences.tabSize}
                        lineWrapping={preferences.lineWrapping}
                        fontSize={preferences.fontSize}
                        onEditorReady={onEditorReady}
                        onFormat={handleFormat}
                    />}
                    <SandboxRunner request={runRequest} onOutput={onRunnerOutput} />
                </div>
                <section className={`output-panel ${output.status !== 'idle' ? 'is-open' : ''}`} aria-labelledby="output-title">
                    <header><div><h2 id="output-title">Output</h2><span>{language.runnable ? 'JavaScript runs in this browser only' : 'Run supports JavaScript only'}</span></div>
                        <button type="button" className="icon-button output-close" aria-label="Clear output" onClick={() => setOutput({ status: 'idle', lines: [] })}>×</button>
                    </header>
                    <div className="output-lines" aria-live="polite">
                        {output.status === 'idle' ? <p>Run JavaScript to see console output and errors here.</p> : output.lines.map((line, index) => <pre className={`output-line ${line.type}`} key={`${index}-${line.text}`}>{line.text}</pre>)}
                        {output.status === 'running' && <p className="output-running">Running locally…</p>}
                    </div>
                    <p className="execution-note">The isolated runner has no access to this room, the parent page, or network requests. A browser tab can still become unresponsive if its runtime fails to stop.</p>
                </section>
            </section>

            <footer className="workspace-footer">
                <div><span className="footer-language">{language.label}</span><span>{cursorPosition}</span><span>{preferences.lineWrapping ? 'Line wrap on' : 'Line wrap off'}</span></div>
                <span className="owner-credit">behindapi © 2026</span>
            </footer>
            <MessagePanel messages={messages} onSend={sendMessage} connected={connectionStatus === 'connected'} />
            {snapshotOpen && <CodeSnapshotDialog
                code={editorApiRef.current?.editor.getValue() || ''}
                language={preferences.language}
                editorTheme={preferences.editorTheme}
                onClose={() => setSnapshotOpen(false)}
            />}
        </main>
    );
};

export default EditorPage;
