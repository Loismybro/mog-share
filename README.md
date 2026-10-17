# MogShare

**Zero-install peer-to-peer file, folder, and message sharing across Android, iOS, Windows, macOS, and Linux.**

MogShare enables direct, high-speed file transfers between devices on the same local Wi-Fi network or mobile hotspot without consuming mobile data, as well as encrypted room-based transfers across separate networks.

---

## Core Features

### 1. Automatic Local & Cross-Network Discovery
- **Local Network Auto-Discovery**: Automatically detects devices connected to the same Wi-Fi router, LAN subnet, or mobile hotspot.
- **Same-Device Multi-Tab Bus**: Instant zero-latency discovery and file transfer between browser tabs on the same machine via `BroadcastChannel`.
- **Global Room Bridge**: Connect devices across different Wi-Fi networks or cellular connections using a 6-character room code or QR code link.
- **Hardware Deduplication**: Automatic session and device signature matching prevents duplicate entries when devices reconnect or switch networks.

### 2. High-Throughput Hybrid P2P Transfer Engine
- **Direct WebRTC DataChannels**: Streams files peer-to-peer over pre-negotiated binary `RTCDataChannel` connections with credit-based flow control.
- **Seamless Relay Fallback**: Automatically falls back to encrypted WebSocket binary relay when strict NATs or firewalls block direct peer connections, and upgrades to direct WebRTC mid-flight as soon as a direct path opens.
- **Folder & Batch Transfers**: Select multiple files or entire directories for sequential or bundled streaming.
- **Real-Time Transfer Telemetry**: Live throughput (`MB/s`), progress percentage, and completion status.

### 3. Cryptographic Integrity & Security
- **SHA-256 Block Verification**: Every transferred block is verified against its SHA-256 digest before being committed, guaranteeing zero file corruption across any file size.
- **End-to-End Verification**: Short Authentication String (SAS) verification and ECDH key exchange support for untrusted networks.

### 4. Personal Vault & Instant Messaging
- **Personal Vault**: Persist frequently shared or received files locally in browser storage (`IndexedDB`) for one-click re-sharing and offline access.
- **Built-In Media Preview**: Preview images, video, audio, text, and code files directly in the browser before saving to disk.
- **Direct Peer Messaging**: Send instant text messages, links, and clipboard snippets directly to any discovered device.

---

## Quickstart

### Install Dependencies
```bash
npm install
```

### Run in Development
```bash
npm run dev
```

### Build & Run for Production
```bash
npm run build
npm start
```

---

## License

MIT
