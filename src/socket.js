import { io } from 'socket.io-client';

export function getSocketUrl() {
    if (process.env.REACT_APP_BACKEND_URL) return process.env.REACT_APP_BACKEND_URL;
    if (process.env.NODE_ENV === 'development') return 'http://localhost:5000';
    return window.location.origin;
}

export const initSocket = () => io(getSocketUrl(), {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
});
