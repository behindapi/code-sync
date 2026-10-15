const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const Y = require('yjs');
const { createApplicationServer, parseAllowedOrigins } = require('../server');
const ACTIONS = require('../src/Actions');

let appServer;
let ioServer;
let service;
let baseUrl;
const clients = new Set();

async function startServer() {
    if (appServer) return;
    ({ server: appServer, io: ioServer, roomService: service } = createApplicationServer({
        buildDir: '/path/that/does/not/exist', allowedOrigins: [], allowOriginless: true,
    }));
    await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${appServer.address().port}`;
}

async function client() {
    await startServer();
    const socket = createClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.add(socket);
    await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    return socket;
}

function request(socket, event, payload) {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitFor(socket, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, 1500);
        const listener = (value) => {
            if (!predicate(value)) return;
            clearTimeout(timeout);
            socket.off(event, listener);
            resolve(value);
        };
        socket.on(event, listener);
    });
}

async function createRoom(socket, displayName) {
    const result = await request(socket, ACTIONS.CREATE, { displayName });
    assert.equal(result.ok, true, result.message);
    return result;
}

after(async () => {
    for (const socket of clients) socket.close();
    if (ioServer) await new Promise((resolve) => ioServer.close(resolve));
    if (service) service.close();
});

test('local origin defaults include the configured HTTP server port', () => {
    const origins = parseAllowedOrigins(undefined, 5123);
    assert.ok(origins.includes('http://localhost:5123'));
    assert.ok(origins.includes('http://127.0.0.1:5123'));
    assert.ok(origins.includes('http://localhost:3000'));
});

test('Yjs updates merge for members and late joiners receive the current document', async () => {
    const first = await client();
    const created = await createRoom(first, 'Ada');
    const docA = new Y.Doc();
    docA.getText('code').insert(0, 'const left = true;');
    const updateA = Y.encodeStateAsUpdate(docA);
    first.emit(ACTIONS.DOCUMENT_UPDATE, { update: updateA });

    const second = await client();
    const joining = waitFor(first, ACTIONS.PRESENCE, (event) => event.participants.length === 2);
    const joined = await request(second, ACTIONS.JOIN, { roomId: created.roomId, displayName: 'Lin' });
    assert.equal(joined.ok, true);
    await joining;
    const docB = new Y.Doc();
    Y.applyUpdate(docB, joined.snapshot);
    assert.equal(docB.getText('code').toString(), 'const left = true;');
    const docConcurrent = new Y.Doc();
    Y.applyUpdate(docConcurrent, joined.snapshot);
    const initialStateVector = Y.encodeStateVector(docB);
    docB.getText('code').insert(docB.getText('code').length, '\nconst right = true;');
    docConcurrent.getText('code').insert(docConcurrent.getText('code').length, '\nconst parallel = true;');
    const updateB = Y.encodeStateAsUpdate(docB, initialStateVector);
    const updateConcurrent = Y.encodeStateAsUpdate(docConcurrent, initialStateVector);
    const updateBack = waitFor(first, ACTIONS.DOCUMENT_UPDATE);
    second.emit(ACTIONS.DOCUMENT_UPDATE, { update: updateB });
    Y.applyUpdate(docA, (await updateBack).update);
    const concurrentUpdateBack = waitFor(first, ACTIONS.DOCUMENT_UPDATE);
    second.emit(ACTIONS.DOCUMENT_UPDATE, { update: updateConcurrent });
    Y.applyUpdate(docA, (await concurrentUpdateBack).update);
    assert.match(docA.getText('code').toString(), /const left = true;/);
    assert.match(docA.getText('code').toString(), /const right = true;/);
    assert.match(docA.getText('code').toString(), /const parallel = true;/);
    docA.destroy();
    docB.destroy();
    docConcurrent.destroy();
});

test('a reconnecting participant merges its local state with the retained room snapshot', async () => {
    const original = await client();
    const created = await createRoom(original, 'Reconnect');
    const localDoc = new Y.Doc();
    localDoc.getText('code').insert(0, 'const kept = 42;');
    original.emit(ACTIONS.DOCUMENT_UPDATE, { update: Y.encodeStateAsUpdate(localDoc) });
    await new Promise((resolve) => setTimeout(resolve, 40));
    original.disconnect();

    const reconnecting = await client();
    const joined = await request(reconnecting, ACTIONS.JOIN, { roomId: created.roomId });
    assert.equal(joined.ok, true);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, joined.snapshot);
    assert.equal(restored.getText('code').toString(), 'const kept = 42;');
    localDoc.destroy();
    restored.destroy();
});

test('rooms isolate edits and messages, and malformed room/message payloads are rejected', async () => {
    const ownerA = await client();
    const roomA = await createRoom(ownerA, 'Room A');
    const ownerB = await client();
    const roomB = await createRoom(ownerB, 'Room B');
    const unrelatedUpdate = waitFor(ownerB, ACTIONS.DOCUMENT_UPDATE, () => true).then(() => 'received');
    const unrelatedMessage = waitFor(ownerB, ACTIONS.MESSAGE_NEW).then(() => 'received');
    const doc = new Y.Doc();
    doc.getText('code').insert(0, 'private to A');
    ownerA.emit(ACTIONS.DOCUMENT_UPDATE, { update: Y.encodeStateAsUpdate(doc) });
    ownerA.emit(ACTIONS.MESSAGE_SEND, { text: 'hello room A' });
    assert.equal(await Promise.race([unrelatedUpdate, new Promise((resolve) => setTimeout(() => resolve('isolated'), 80))]), 'isolated');
    assert.equal(await Promise.race([unrelatedMessage, new Promise((resolve) => setTimeout(() => resolve('isolated'), 80))]), 'isolated');

    const rejectedRoom = await request(ownerB, ACTIONS.JOIN, { roomId: 'not-a-uuid' });
    assert.equal(rejectedRoom.ok, false);
    assert.equal(rejectedRoom.code, 'INVALID_ROOM_ID');
    const invalidMessage = waitFor(ownerB, ACTIONS.ERROR, (event) => event.code === 'INVALID_MESSAGE');
    ownerB.emit(ACTIONS.MESSAGE_SEND, { text: 'x'.repeat(281) });
    assert.equal((await invalidMessage).code, 'INVALID_MESSAGE');
    const oversizedDoc = new Y.Doc();
    oversizedDoc.getText('code').insert(0, 'x'.repeat(257 * 1024));
    const oversizedUpdate = waitFor(ownerB, ACTIONS.ERROR, (event) => event.code === 'INVALID_UPDATE');
    ownerB.emit(ACTIONS.DOCUMENT_UPDATE, { update: Y.encodeStateAsUpdate(oversizedDoc) });
    assert.equal((await oversizedUpdate).code, 'INVALID_UPDATE');
    assert.equal(service.rooms.get(roomB.roomId).doc.getText('code').length, 0);
    doc.destroy();
    oversizedDoc.destroy();
    assert.ok(roomA.roomId !== roomB.roomId);
});
