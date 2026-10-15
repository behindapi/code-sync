const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const ACTIONS = require('./src/Actions');
const { attachRoomService, MAX_SOCKET_PACKET_BYTES } = require('./server/roomService');

function parseAllowedOrigins(value = process.env.ALLOWED_ORIGINS, port = Number(process.env.PORT) || 5000) {
    if (value) {
        return value.split(',').map((origin) => origin.trim()).filter(Boolean);
    }
    if (process.env.NODE_ENV !== 'production') {
        return [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            `http://localhost:${port}`,
            `http://127.0.0.1:${port}`,
        ];
    }
    return [];
}

function createApplicationServer({
    buildDir = path.join(__dirname, 'build'),
    allowedOrigins = parseAllowedOrigins(),
    allowOriginless = process.env.NODE_ENV !== 'production',
} = {}) {
    const app = express();
    const server = http.createServer(app);
    const originSet = new Set(allowedOrigins);
    const io = new Server(server, {
        maxHttpBufferSize: MAX_SOCKET_PACKET_BYTES,
        cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
        allowRequest: (request, callback) => {
            const origin = request.headers.origin;
            callback(null, origin ? originSet.has(origin) : allowOriginless);
        },
    });

    app.disable('x-powered-by');
    app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok' }));
    app.use(express.static(buildDir, { index: false, fallthrough: true }));
    app.get('*', (request, response) => {
        if (request.path.startsWith('/socket.io/')) {
            return response.sendStatus(404);
        }
        response.sendFile(path.join(buildDir, 'index.html'), (error) => {
            if (error && !response.headersSent) {
                response.status(503).send('The Code Sync client has not been built yet. Run npm run build.');
            }
        });
    });

    const roomService = attachRoomService(io);
    return { app, server, io, roomService };
}

if (require.main === module) {
    const origins = parseAllowedOrigins();
    if (process.env.NODE_ENV === 'production' && origins.length === 0) {
        throw new Error('Set ALLOWED_ORIGINS to the exact public application origin in production.');
    }
    const { server } = createApplicationServer({ allowedOrigins: origins });
    const port = Number(process.env.PORT) || 5000;
    server.listen(port, '0.0.0.0', () => {
        console.log(`Code Sync listening on port ${port}`);
    });
}

module.exports = { createApplicationServer, parseAllowedOrigins, ACTIONS };
