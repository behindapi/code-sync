# Code Sync

Code Sync is a browser-based collaborative code editor. Create or join a room without an account, share its link, and edit together in CodeMirror 5.

## Requirements

- Node.js 18 or newer (Node 20 LTS recommended)
- npm

## Run locally

Run these commands from the repository root. Install the locked dependencies once:

```bash
npm ci
```

### Development mode

Open two terminals in the repository root. In the first, start Express and Socket.IO:

```bash
PORT=5123 npm run server:dev
```

In the second, start the React development server:

```bash
npm run start:front
```

Open [http://localhost:3000](http://localhost:3000). In development, React serves the UI and connects to Express/Socket.IO at `http://localhost:5000`.

### One-terminal run

To build the React app and serve it with Express from one terminal, use:

```bash
npm run build && PORT=5123 npm run server:prod
```

Then open [http://localhost:5123](http://localhost:5123). The app and room service share that origin. `PORT=5123` is used here because port 5000 may already be occupied; you can replace `5123` with another free port. If port 5000 is free, use `npm run build && npm run server:prod` and open [http://localhost:5000](http://localhost:5000). `npm start` also builds the app and starts Express, using port 5000 by default. Stop a running server with **Ctrl+C**.

To check that Express is responding, open `http://localhost:<port>/healthz`; it should return `{"status":"ok"}`. If the server reports `EADDRINUSE`, that port is already in use. Choose another free port, such as `PORT=5123`, instead of stopping an unrelated process.

If you set `NODE_ENV=production` locally, also set `ALLOWED_ORIGINS` to the exact origin you use, for example `ALLOWED_ORIGINS=http://localhost:5123`. Production startup requires this setting. For a custom backend port in development mode, set the same backend URL when starting React, for example `REACT_APP_BACKEND_URL=http://localhost:5123 npm run start:front`.

## Use rooms

Create a room from the entry page, then copy the invite link from the editor. Opening `/editor/<room-id>` directly joins an existing room. A display name is optional; the server generates a temporary label when one is not provided. Anyone with the room link can edit. There are no accounts or identity verification.

Rooms and documents live in memory in one Node process. An empty room is retained for up to 10 minutes to support a reconnect, then removed. Process restarts, deployments, and host sleep clear room documents. Room messages are not stored by the server; only connected room participants receive them. The server limits rooms to 16 participants and document source to 256 KiB.

## Editor capabilities

- CodeMirror 5 syntax highlighting for JavaScript, JSON, CSS, HTML, Python, Java, C, and C++.
- Per-browser language, theme, appearance, wrapping, indentation, and font-size preferences stored in local storage.
- Browser-local Prettier formatting for JavaScript/JSX, JSON, CSS, and HTML. Other languages are explicitly unsupported by the Format action.
- Code snapshots can be previewed and exported as PNG. Clipboard image copy depends on browser support and a secure context; download is the fallback.
- Short in-room messages are text-only, limited to 280 characters, and are not retained by the service.
- **Run executes JavaScript only**, in a sandboxed iframe and a separate Web Worker with a restrictive CSP, output cap, and timeout. Other language modes provide highlighting only.

The runner does not call `eval` or `new Function` in the application page. The iframe has an opaque origin and the worker has no network access under the frame’s CSP. Browser isolation reduces access to the parent page and its room state; it is not a hardened operating-system sandbox. Browser vulnerabilities, implementation bugs, and resource exhaustion remain possible. Use this as a learning/demo tool and do not paste untrusted code into a browser you rely on for sensitive work.

## Collaboration protocol and security

The client owns a Yjs document bound to CodeMirror with `y-codemirror`. On create/join, the server acknowledges the room ID, temporary participant label, participant list, Yjs snapshot, and state vector. The client applies the snapshot and sends local state missing from that vector. Subsequent Yjs updates are validated and broadcast only to the server-derived room membership. CRDT updates merge concurrent text edits; reconnecting clients merge local state with the room snapshot rather than replacing a whole document.

Socket.IO event names and payloads are defined in `src/Actions.js`:

| Event                  | Direction       | Payload                                                                                   |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `room:create`          | client → server | `{ displayName? }`; acknowledged with room ID, participant(s), snapshot, and state vector |
| `room:join`            | client → server | `{ roomId, displayName? }`; same acknowledgement shape                                    |
| `room:document-update` | both directions | `{ update }` (Yjs binary update)                                                          |
| `room:presence`        | server → room   | `{ participants: [{ socketId, displayName }] }`                                           |
| `room:message-send`    | client → server | `{ text }`                                                                                |
| `room:message-new`     | server → room   | `{ messageId, displayName, sentAt, text }`                                                |
| `room:error`           | server → client | `{ code, message }` for non-acknowledged errors                                           |

The server enforces UUID room IDs, display-name and message bounds, Socket.IO packet and document limits, a 16-person room cap, per-IP room action limits, and per-socket document/message rate limits. A room link is a bearer invite: do not use it for confidential code. Presence labels are temporary and are not authenticated identities. The deployment must allow WebSocket upgrades and configure exact allowed origins. In-memory rooms are designed for a single server process; horizontal scaling requires shared durable state and a Socket.IO adapter, neither of which is included.

## Deploy on a zero-budget host

Use a **single Render Free Web Service**, not a static-only site: the Express process serves the React build and keeps the Socket.IO connection on the same origin.

1. Create a Web Service from this repository.
2. Set the build command to `npm ci && npm run build`.
3. Set the start command to `npm run server:prod`.
4. Set `NODE_ENV=production` and `ALLOWED_ORIGINS=https://<your-service>.onrender.com` (replace with the exact public origin; include any custom origin if used).
5. Render supplies `PORT`; the server binds to it and serves both the UI and Socket.IO.

Render currently documents inbound WebSocket support on web services. Its Free web services sleep after 15 minutes without inbound HTTP traffic or WebSocket messages, can take about a minute to wake, and receive 750 free instance hours per workspace per calendar month. Free services are limited to one instance, so the in-memory room model can be lost on sleep, restart, or deploy and is not shared across instances. Treat this as a hobby/demo deployment, not durable production hosting. Free-tier terms can change; review [Render Free instance limits](https://render.com/docs/free) and [Render WebSocket guidance](https://render.com/docs/websocket) before deploying.

## Checks

```bash
npm run build
npm run test:ci -- --runInBand
npm run test:server
```

The server integration tests bind a temporary loopback port. A build does not verify deployment connectivity; test collaboration with two browser sessions after deploying.

## License and ownership

Released under the MIT License. See [LICENSE](LICENSE) for the complete terms and upstream attribution. Product ownership credit: **behindapi © 2026**.
