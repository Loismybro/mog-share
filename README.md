# ⚡ MogShare 3.0 — Cross-Platform P2P Sharing Hub

> **Zero-install peer-to-peer file, folder, and snippet sharing across Android, iOS, Windows, macOS, and Linux.**  
> Powered by WebRTC DataChannels, Dual-Stack LAN/Hotspot & Multi-Tab Auto-Discovery, SHA-256 Block Verification, Persistent Personal Space Vault, and the **Twilight Horizon** (Bright-to-Slight-Dark) Dashboard UI.

---

## ✨ Key Capabilities

### 🛰️ 1. Automatic Device Detection & Multi-Layer Discovery
* **Smart Hardware & OS Fingerprinting**: Automatically detects device make/model, operating system, browser engine, network link type, local LAN IP, and battery telemetry using User-Agent Client Hints (`navigator.userAgentData`), Network Information API, and Battery Status API.
* **Instant LAN & Mobile Hotspot Grouping**: Devices connected to the same Wi-Fi router, `/24` subnet, or mobile hotspot automatically appear in the live orbital sonar radar within 1 second.
* **Zero-Latency Multi-Tab Bus (`BroadcastChannel`)**: Multiple tabs or windows on the same device discover each other and transfer files/messages in `<15ms`—even when offline.
* **Cross-Network Room Bridge**: 8-character unambiguous room codes (`ABCD2345`) + dynamic QR codes and optional AES-GCM passphrase encryption for sharing across different networks or cellular data.
* **Interactive Demo Peer Loopback Mode**: 1-click **Simulate Peer** mode spawns a virtual `Galaxy S25 Ultra` peer that runs the real sender/receiver transfer pipeline in loopback so you can test file transfers, progress, vault storage, and live chat on a single device.

### 🚀 2. High-Speed Hybrid P2P + Relay Transfer Engine
* **True P2P WebRTC DataChannels**: Pre-negotiated binary data channels (`16 KiB` chunks, `4 MiB` SHA-256 verified blocks) with W3C Perfect Negotiation and 2-layer credit flow control.
* **Automatic Hybrid Relay Fallback**: If strict NAT/firewalls block direct WebRTC, transfers seamlessly switch to E2E Encrypted (ECDH P-256 + AES-256-GCM) or binary base64 relay without failing.
* **Real-Time Telemetry & Controls**: Live progress bar, smoothed transfer speed (`MB/s`), ETA countdown, **Pause / Resume**, **Cancel**, **Retry**, and **Bundle Multiple Files as ZIP** on the fly.
* **Stream-to-Disk Storage**: Uses File System Access API (`FSA`), Origin Private File System (`OPFS`), or memory storage with automatic quota verification.

### 🗄️ 3. Personal Space Vault & Built-in Media Viewers
* **Persistent IndexedDB Vault**: Automatically saves received files locally by category (`Photos`, `Videos`, `Music`, `Docs`, `APKs`, `Archives`) with search, sorting, local file import, and batch **Export as ZIP**.
* **In-App Previewers**: Image lightbox with zoom, audio player with animated equalizer, HTML5 video player, code/text viewer with 1-click copy, PDF viewer, and APK package inspector.

### 💬 4. Live P2P Chat & Shared Clipboard
* **Broadcast or Direct Peer Messaging**: Send text, clickable links, or code snippets to all connected devices or directly to a single peer.
* **Auto-Copy Option**: Optional toggle to automatically copy incoming snippets to your system clipboard.

---

## 🛠️ Project Structure

```text
mog-share/
├── apps/
│   ├── signaling/          # Express + WebSocket/SSE/Long-Poll signaling & TURN credential server
│   └── web/                # React 19 + TypeScript + Vite + Tailwind CSS dashboard client
├── packages/
│   └── shared/             # Shared binary protocol framing, constants, and crypto utilities
├── tests/                  # Vitest unit & integration test suites
├── Dockerfile              # Unified single-container production build
└── docker-compose.yml      # Self-hosted stack with optional coturn TURN server
```

---

## 🚀 Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
Starts both the signaling server (`http://localhost:4000`) and Vite web client (`http://localhost:5173`) concurrently:
```bash
npm run dev
```
* Open `http://localhost:5173` in your browser.
* To pair a phone on the same Wi-Fi, click **Connect Phone / PC** in the sidebar and scan the QR code (or open `http://<your-lan-ip>:5173`).
* To test on a single machine immediately, click **Simulate Peer (Test)** in the sidebar or open a second browser tab!

### 3. Build & Run for Production
```bash
npm run build
npm start
```
Serves both the compiled web dashboard and the WebSocket signaling server on a single port (`PORT=4000` by default).

### 4. Run Automated Tests
```bash
npm test
```

---

## 📄 License

MIT
