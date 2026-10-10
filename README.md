# Mog Share

Simple cross-platform file sharing between your devices — in the browser, no installs.

Devices on the **same network** discover each other automatically (grouped by public IP on the server). Devices on **different networks** connect with a 6-digit room code or QR link. Files travel **peer-to-peer over WebRTC data channels** when a direct connection is possible (shown as **Direct**); otherwise they are relayed through the server (shown as **Relayed (slower)** — the relay path is not end-to-end encrypted).

## What's honest here

- Transfers are P2P **when WebRTC connects** (STUN, optional TURN). Otherwise they go through your server relay.
- Large files: on desktop Chromium, files ≥ 64 MB are **streamed straight to disk** via the File System Access API. On iOS/Firefox they are held in memory, so the app warns above 500 MB. There is no "unlimited size".
- Speed depends entirely on your network. Nothing is hard-coded.

## Features

- **Nearby discovery** grouped by public IP on the server, with a room-code escape hatch for VPNs / guest Wi-Fi.
- **Rooms** with crypto-random 6-digit codes, QR links, host handover, TTLs, and join rate limiting.
- **True P2P** WebRTC data channels with an honest *Direct* / *Relayed (slower)* badge, SHA-256 integrity verification, and a max-2-concurrent send queue.
- **Room passphrase (optional E2E for relayed data)**: PBKDF2 → AES-GCM encrypts relay-path file chunks and clipboard text, so the server can't read them. Direct P2P data never touches the server at all.
- **Relay transfers survive reconnects** — a dropped Wi-Fi link pauses the stream for up to 30 s instead of failing it.
- **PWA**: installable, offline shell, and Android share-sheet target (share files straight into the app).
- **Folder drag & drop**, paste-to-send (Ctrl/Cmd+V), image thumbnails, and *Download all as ZIP* for multi-file receives.
- **History** persisted in IndexedDB, **trusted devices** auto-accept, diagnostics with live latency, light/dark theme toggle.

## Quickstart (local)

```bash
npm install
npm run dev
```

- Server: http://localhost:4000 (WebSocket at `/ws`)
- Client: http://localhost:5173 (Vite proxies `/ws` and `/api` to the server)

**Test with a phone:** open the LAN URL Vite prints (e.g. `http://192.168.1.23:5173`) on a phone on the same Wi-Fi. Both devices appear in *Nearby* within a few seconds.

## Production (single origin — recommended)

```bash
npm run build:client   # builds packages/client/dist
npm start              # Express serves the client build + WebSocket on one port
```

Deploy `packages/server` to Render / Fly / Railway (start command `npm start`, root directory the repo root). The server serves the client build, the `/ws` WebSocket, `/api/health` and `/api/info` from one origin — no extra config needed.

> **Free-tier cold starts:** Render free instances sleep and take 30–60 s to wake. The client pre-fires `/api/health` to wake the server and waits up to 20 s per connection attempt, showing "Waking up server…".

## Split deployment (Vercel client + Render server)

1. Deploy the server anywhere that supports WebSockets (Render: `npm start --prefix packages/server`).
2. Deploy the client to Vercel with env var `VITE_WS_URL=wss://your-server.onrender.com/ws`.
3. Or skip env vars entirely: users can paste the server URL in **Settings → Server URL**, or append `?ws=wss://...` to the page URL.

## Optional environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_WS_URL` | client build | default WebSocket server URL |
| `VITE_TURN_URL` / `VITE_TURN_USER` / `VITE_TURN_PASS` | client build | TURN server for strict NATs |
| `CORS_ORIGINS` | server | comma-separated allowed origins (default: all) |
| `PORT` | server | listen port (default 4000) |

## Self-hosting with Docker (optional)

```bash
TURN_USER=mog TURN_PASS=change-me docker compose up -d
```

Runs the server (port 4000, serving the built client) plus a coturn TURN relay for strict NATs. Build the client with `VITE_TURN_URL=turn:YOUR_HOST:3478 VITE_TURN_USER=... VITE_TURN_PASS=...` to use it.

## Tests

```bash
npm test
```

Runs the server's Vitest suite: network grouping by public IP, room-code generation/normalization, and join rate limiting.

## How discovery works

1. The client connects to the server over WebSocket (`?ws=` param → Settings value → `VITE_WS_URL` → same origin `/ws`).
2. The server groups devices by apparent public IP (IPv4 address, or IPv6 /64 prefix) and only shows devices within the same group.
3. If devices are on different networks (VPN, IPv4 vs IPv6, guest Wi-Fi), use a **room code** — rooms work across any network.

The client reconnects automatically with exponential backoff, re-registers, and re-joins its room after a drop. The server pings every socket every 25 s and keeps a 60 s grace period for reconnects.
