const { randomUUID, randomInt } = require('crypto');
const Y = require('yjs');
const ACTIONS = require('../src/Actions');

const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOCKET_PACKET_BYTES = 1024 * 1024;
const MAX_UPDATE_BYTES = 256 * 1024;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_DOCUMENT_STATE_BYTES = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 280;
const MAX_PARTICIPANTS = 16;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const REMOTE_ORIGIN = 'socket-update';

function createWindowLimiter(limit, windowMs) {
    const entries = new Map();
    return {
        allow(key, now = Date.now()) {
            const current = (entries.get(key) || []).filter((time) => now - time < windowMs);
            if (current.length >= limit) {
                entries.set(key, current);
                return false;
            }
            current.push(now);
            entries.set(key, current);
            if (entries.size > 5000) {
                for (const [entryKey, timestamps] of entries) {
                    if (!timestamps.some((time) => now - time < windowMs)) entries.delete(entryKey);
                }
            }
            return true;
        },
    };
}

function normalizeDisplayName(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, displayName: `Coder ${randomInt(1000, 10000)}` };
    }
    if (typeof value !== 'string' || value.length > 64) return { ok: false };
    const displayName = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (!displayName || displayName.length > 32) return { ok: false };
    return { ok: true, displayName };
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (Buffer.isBuffer(value)) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function attachRoomService(io, options = {}) {
    const rooms = new Map();
    const joinLimiter = createWindowLimiter(options.joinsPerMinute || 20, 60 * 1000);
    const socketActionLimiter = createWindowLimiter(120, 1000);
    const messageLimiter = createWindowLimiter(8, 10 * 1000);
    const roomTimers = new Map();

    function participantList(room) {
        return Array.from(room.participants, ([socketId, displayName]) => ({ socketId, displayName }));
    }

    function sendError(socket, code, message, acknowledge) {
        const payload = { ok: false, code, message };
        if (typeof acknowledge === 'function') acknowledge(payload);
        else socket.emit(ACTIONS.ERROR, payload);
    }

    function roomForSocket(socket) {
        const roomId = socket.data.roomId;
        return roomId ? rooms.get(roomId) : undefined;
    }

    function cleanRoomIfEmpty(roomId, room) {
        if (room.participants.size) return;
        const timer = setTimeout(() => {
            if (room.participants.size) return;
            room.doc.off('update', room.onUpdate);
            room.doc.destroy();
            rooms.delete(roomId);
            roomTimers.delete(roomId);
        }, options.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS);
        timer.unref?.();
        roomTimers.set(roomId, timer);
    }

    function addParticipant(socket, roomId, room, displayName, acknowledge) {
        if (socket.data.roomId) {
            sendError(socket, 'ALREADY_IN_ROOM', 'Leave the current room before joining another.', acknowledge);
            return;
        }
        if (room.participants.size >= (options.maxParticipants || MAX_PARTICIPANTS)) {
            sendError(socket, 'ROOM_FULL', 'This room has reached its participant limit.', acknowledge);
            return;
        }

        const timer = roomTimers.get(roomId);
        if (timer) clearTimeout(timer);
        roomTimers.delete(roomId);
        socket.data.roomId = roomId;
        socket.data.displayName = displayName;
        socket.join(roomId);
        room.participants.set(socket.id, displayName);

        const payload = {
            ok: true,
            roomId,
            participant: { socketId: socket.id, displayName },
            participants: participantList(room),
            snapshot: Y.encodeStateAsUpdate(room.doc),
            stateVector: Y.encodeStateVector(room.doc),
        };
        if (typeof acknowledge === 'function') acknowledge(payload);
        io.to(roomId).emit(ACTIONS.PRESENCE, { participants: payload.participants });
    }

    function createRoom(socket, payload, acknowledge) {
        if (!joinLimiter.allow(socket.handshake.address || socket.id)) {
            sendError(socket, 'RATE_LIMITED', 'Too many room actions. Please wait and try again.', acknowledge);
            return;
        }
        const name = normalizeDisplayName(payload && payload.displayName);
        if (!name.ok) {
            sendError(socket, 'INVALID_NAME', 'Use a display name of 1 to 32 characters.', acknowledge);
            return;
        }
        if (socket.data.roomId) {
            sendError(socket, 'ALREADY_IN_ROOM', 'Leave the current room before creating another.', acknowledge);
            return;
        }

        const roomId = randomUUID();
        const doc = new Y.Doc();
        const room = { doc, participants: new Map(), onUpdate: null };
        room.onUpdate = (update, origin) => {
            if (origin === REMOTE_ORIGIN) return;
            io.to(roomId).except(origin).emit(ACTIONS.DOCUMENT_UPDATE, { update });
        };
        doc.on('update', room.onUpdate);
        rooms.set(roomId, room);
        addParticipant(socket, roomId, room, name.displayName, acknowledge);
    }

    function joinRoom(socket, payload, acknowledge) {
        if (!joinLimiter.allow(socket.handshake.address || socket.id)) {
            sendError(socket, 'RATE_LIMITED', 'Too many room actions. Please wait and try again.', acknowledge);
            return;
        }
        const roomId = payload && payload.roomId;
        if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
            sendError(socket, 'INVALID_ROOM_ID', 'That room link is not valid.', acknowledge);
            return;
        }
        const room = rooms.get(roomId);
        if (!room) {
            sendError(socket, 'ROOM_NOT_FOUND', 'This room has expired or does not exist. Create a new room to continue.', acknowledge);
            return;
        }
        const name = normalizeDisplayName(payload && payload.displayName);
        if (!name.ok) {
            sendError(socket, 'INVALID_NAME', 'Use a display name of 1 to 32 characters.', acknowledge);
            return;
        }
        addParticipant(socket, roomId, room, name.displayName, acknowledge);
    }

    function leaveRoom(socket) {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        socket.data.roomId = null;
        socket.data.displayName = null;
        socket.leave(roomId);
        if (!room) return;
        room.participants.delete(socket.id);
        io.to(roomId).emit(ACTIONS.PRESENCE, { participants: participantList(room) });
        cleanRoomIfEmpty(roomId, room);
    }

    function documentUpdate(socket, payload) {
        const room = roomForSocket(socket);
        const update = toUint8Array(payload && payload.update);
        if (!room || !update || update.byteLength === 0 || update.byteLength > MAX_UPDATE_BYTES) {
            sendError(socket, 'INVALID_UPDATE', 'The code update could not be accepted.');
            return;
        }
        if (!socketActionLimiter.allow(socket.id)) {
            sendError(socket, 'RATE_LIMITED', 'Code is changing too quickly. Please pause briefly.');
            return;
        }

        const candidate = new Y.Doc();
        try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            Y.applyUpdate(candidate, update);
            const documentBytes = Buffer.byteLength(candidate.getText('code').toString(), 'utf8');
            const totalStateBytes = Y.encodeStateAsUpdate(candidate).byteLength;
            if (documentBytes > (options.maxDocumentBytes || MAX_DOCUMENT_BYTES) || totalStateBytes > MAX_DOCUMENT_STATE_BYTES) {
                sendError(socket, 'DOCUMENT_TOO_LARGE', 'This room has reached its code size limit.');
                return;
            }
            Y.applyUpdate(room.doc, update, REMOTE_ORIGIN);
            io.to(socket.data.roomId).except(socket.id).emit(ACTIONS.DOCUMENT_UPDATE, { update });
        } catch (_error) {
            sendError(socket, 'INVALID_UPDATE', 'The code update could not be accepted.');
        } finally {
            candidate.destroy();
        }
    }

    function sendMessage(socket, payload) {
        const roomId = socket.data.roomId;
        const room = roomForSocket(socket);
        const text = payload && payload.text;
        if (!room || typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
            sendError(socket, 'INVALID_MESSAGE', `Messages must contain 1 to ${MAX_MESSAGE_LENGTH} characters.`);
            return;
        }
        if (!messageLimiter.allow(socket.id)) {
            sendError(socket, 'RATE_LIMITED', 'Please wait before sending another message.');
            return;
        }
        const message = {
            messageId: randomUUID(),
            displayName: socket.data.displayName,
            sentAt: new Date().toISOString(),
            text: text.trim(),
        };
        io.to(roomId).emit(ACTIONS.MESSAGE_NEW, message);
    }

    io.on('connection', (socket) => {
        socket.data.roomId = null;
        socket.data.displayName = null;
        socket.on(ACTIONS.CREATE, (payload, acknowledge) => createRoom(socket, payload || {}, acknowledge));
        socket.on(ACTIONS.JOIN, (payload, acknowledge) => joinRoom(socket, payload || {}, acknowledge));
        socket.on(ACTIONS.LEAVE, () => leaveRoom(socket));
        socket.on(ACTIONS.DOCUMENT_UPDATE, (payload) => documentUpdate(socket, payload));
        socket.on(ACTIONS.MESSAGE_SEND, (payload) => sendMessage(socket, payload));
        socket.on('disconnecting', () => leaveRoom(socket));
    });

    return {
        rooms,
        close() {
            for (const timer of roomTimers.values()) clearTimeout(timer);
            for (const room of rooms.values()) {
                room.doc.off('update', room.onUpdate);
                room.doc.destroy();
            }
            roomTimers.clear();
            rooms.clear();
        },
    };
}

module.exports = {
    attachRoomService,
    ROOM_ID_PATTERN,
    MAX_SOCKET_PACKET_BYTES,
    MAX_UPDATE_BYTES,
    MAX_DOCUMENT_BYTES,
    MAX_MESSAGE_LENGTH,
    MAX_PARTICIPANTS,
    EMPTY_ROOM_TTL_MS,
    toUint8Array,
};
