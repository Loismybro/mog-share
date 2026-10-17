# ⚡ MogShare v3.0 — Neural P2P File Sharing Hub

> **Zero-data local Wi-Fi and global encrypted room file sharing across Android, iOS, Windows, macOS, and Linux.**  
> Powered by WebRTC DataChannels, 3D WebGL **BriarGlobe** Neural Thread Sphere Discovery, **CipherReach** Interactive Glyph Matrix, **MorphingGlyphCloud** Kinetic Typography, and SHA-256 Block-Verified Streaming.

---

## ✨ Key Capabilities

### 🌐 1. Originkit 3D & Kinetic Visual Architecture
* **BriarGlobe 3D Neural Sphere Radar**: Interactive WebGL 3D neural thread sphere where discovered local Wi-Fi and online room peers appear as live glowing 3D knots. Hover or click any knot in 3D space (or tap its peer card below) to beam files or chat immediately.
* **CipherReach Interactive Hero & Backdrop**: Two reaching hands rendered in a procedural ASCII/glyph matrix with interactive cursor physics.
* **MorphingGlyphCloud Kinetic Typography**: Real-time canvas particle glyph cloud that morphs across status phrases with cursor repulsion.
* **Obsidian Glass Interface**: Deep obsidian (`#07090F`) glassmorphic surfaces with `Space Grotesk`, `Plus Jakarta Sans`, and `JetBrains Mono` telemetry.

### 🚀 2. High-Velocity Hybrid P2P + Relay Transfer Engine
* **Zero-Stall Multi-Transport Streaming**: Automatically selects the fastest path—same-device `BroadcastChannel` memory bus, direct WebRTC `RTCDataChannel` burst mode (`60 KB` chunks, `4 MB` blocks), or instant WebSocket binary relay with seamless mid-flight upgrade to direct WebRTC.
* **SHA-256 Block Integrity**: Strict contiguous chunk validation and cryptographic SHA-256 block verification ensure zero file corruption for any file type or size.
* **Hardware-Signature Peer Deduplication**: Server-side (`LocalGroupIndex` & room registries) and client-side hardware fingerprinting immediately evict ghost sessions on reconnect or tab refresh so duplicate devices never accumulate.

### 🛰️ 3. Local Wi-Fi Mesh & 6-Digit Global Rooms
* **Zero-Data Local Mesh**: Automatically discovers devices sharing the same Wi-Fi router, LAN subnet, or mobile hotspot.
* **6-Character Encrypted Room Bridge**: Connect devices across different networks or cellular data using a 6-digit room code or instant QR code (`?room=CODE`).
* **Personal Space Vault**: Pin frequently shared or received files in IndexedDB for 1-click staging and beaming.

---

## 🛠️ Project Structure

```text
mog-share/
├── apps/
│   ├── signaling/          # Express + WebSocket signaling, LAN grouping, room bridge & ZIP export
│   └── web/                # React 19 + TypeScript + Vite + Tailwind CSS + WebGL 3D client
├── packages/
│   └── shared/             # Shared binary protocol framing, constants, and SHA-256 utilities
├── render.yaml             # Render.com 1-click production blueprint
├── Dockerfile              # Unified single-container production build
└── docker-compose.yml      # Self-hosted stack
```

---

## 🚀 Deployment (Render / Docker / Node)

This repository is pre-configured for **Render** via `render.yaml`:
- **Build Command**: `npm install --include=dev && npm run build`
- **Start Command**: `npm start`
- Serves both the compiled production web app (`apps/web/dist`) and the WebSocket signaling server (`/ws`, `/api/*`) on Render's injected `PORT`.
