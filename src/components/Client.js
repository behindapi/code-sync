import React from 'react';

const Client = ({ username, compact = false }) => (
    <span className={`client-presence ${compact ? 'is-compact' : ''}`} title={username}>
        <span className="client-avatar" aria-hidden="true">{(username || 'C').trim().charAt(0).toUpperCase()}</span>
        {!compact && <span className="client-name">{username}</span>}
        {compact && <span className="sr-only">{username}</span>}
    </span>
);

export default Client;
