import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import '../pages/RoomPage.css';

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const Home = () => {
    const navigate = useNavigate();
    const [roomId, setRoomId] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [startingAction, setStartingAction] = useState('');
    const [roomIdError, setRoomIdError] = useState('');

    const createRoom = () => {
        if (startingAction) return;
        setStartingAction('create');
        navigate('/editor/new', { state: { displayName: displayName.trim() } });
    };

    const joinRoom = (event) => {
        event.preventDefault();
        const cleanRoomId = roomId.trim();
        if (!ROOM_ID_PATTERN.test(cleanRoomId)) {
            setRoomIdError('Enter a valid room ID or open the invite link.');
            toast.error('Enter a valid room ID or open the invite link.');
            return;
        }
        if (startingAction) return;
        setRoomIdError('');
        setStartingAction('join');
        navigate(`/editor/${cleanRoomId}`, { state: { displayName: displayName.trim() } });
    };

    return (
        <main className="entry-page">
            <header className="entry-header">
                <a className="brand-lockup" href="/" aria-label="Code Sync home">
                    <span className="brand-name">Code Sync</span>
                </a>
            </header>

            <section className="entry-layout" aria-labelledby="entry-title">
                <div className="entry-copy">

                    <p className="entry-kicker">A SHARED SPACE FOR CODE</p>
                    <h1 id="entry-title">Build ideas, side by side.</h1>
                    <p className="entry-description">Create a room, share one link, and write code together in real time.</p>

                </div>

                <section className="entry-panel" aria-labelledby="start-title">
                    <div className="entry-panel-heading">
                        <span className="panel-mark" aria-hidden="true">↗</span>
                        <div>
                            <h2 id="start-title">Start a session</h2>
                            <p>No account needed. Your room link is your invite.</p>
                        </div>
                    </div>
                    <label className="field-label" htmlFor="display-name">Name <span>(optional)</span></label>
                    <input
                        id="display-name"
                        className="entry-input name-input"
                        type="text"
                        autoComplete="nickname"
                        maxLength={32}
                        placeholder="Enter your display name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                    />
                    <button className="primary-action" type="button" onClick={createRoom} disabled={Boolean(startingAction)} aria-busy={startingAction === 'create'}>
                        {startingAction === 'create' ? 'Creating room…' : 'Create a room'}
                    </button>
                    <div className="entry-divider"><span>or join a room</span></div>
                    <form onSubmit={joinRoom}>
                        <label className="field-label" htmlFor="room-id">Room ID</label>
                        <input
                            id="room-id"
                            className="entry-input room-id-input"
                            type="text"
                            autoComplete="off"
                            spellCheck="false"
                            aria-invalid={Boolean(roomIdError)}
                            aria-describedby={roomIdError ? 'room-id-error' : undefined}
                            placeholder="Paste an invite room ID"
                            value={roomId}
                            onChange={(event) => {
                                setRoomId(event.target.value);
                                if (roomIdError) setRoomIdError('');
                            }}
                        />
                        {roomIdError && <p className="field-error" id="room-id-error" role="alert">{roomIdError}</p>}
                        <button className="secondary-action" type="submit" disabled={Boolean(startingAction)} aria-busy={startingAction === 'join'}>
                            {startingAction === 'join' ? 'Joining room…' : <>Join room <span aria-hidden="true">→</span></>}
                        </button>
                    </form>
                    <p className="room-access-note">Anyone with the room link can join and edit.</p>
                </section>
            </section>

            <footer className="entry-footer">
                <span>Built for a clearer way to think together.</span>
                <span className="owner-credit">behindapi © 2026</span>
            </footer>
        </main>
    );
};

export default Home;
