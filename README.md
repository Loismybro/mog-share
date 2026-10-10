# ⚡ MogShare

> **Next-generation, browser-based peer-to-peer file sharing.**  
> Blazing-fast transfers between Android, iOS, Windows, Mac, and Linux with zero installations. Built with WebRTC DataChannels, Neo-Brutalist aesthetics with odd pale colors, persistent Personal Space vault, and Xender-grade discovery modes.

---

## ✨ Features at a Glance

### 📱 Android & Cross-Platform Sharing (Xender / SHAREit Style)
* **Giant Hero Action Buttons**: Instant 1-tap **SEND** and **RECEIVE** action modes directly on the home screen.
* **Radar Scanner Discovery**: Visual sweeping sonar beam with orbiting device avatars for intuitive AirDrop/Xender-style 1-tap sends.
* **Categorized File Pickers**: Dedicated quick-pick tabs for **Photos**, **Music**, **Videos**, **Docs**, **APKs**, and **All Files**.
* **Receive Mode**: Full-screen receiver beacon mode with animated sonar pulse, hotspot discovery, and dynamic QR code generation.
* **Connect to PC (WebShare)**: Zero-install PC/Mac transfer mode allowing any computer browser to connect and transfer files via local Wi-Fi or hotspot.
* **Brutalist PIN Keypad**: Tactile numeric keypad for fast 6-digit room code entry.

### 🗄️ In-App File Opening & Personal Space Vault
* **In-App Media Viewers**:
  * **Images**: High-resolution lightbox with zoom in/out, panning, and reset.
  * **Audio**: Retro brutalist audio player featuring animated equalizer frequency bars, scrubber, play/pause, volume control, and mute toggle.
  * **Videos**: Embedded HTML5 player with fallback for exotic codecs.
  * **Documents & Code**: Formatted code/text viewer with 1-click **Copy Text**.
  * **PDFs**: In-browser PDF renderer.
  * **APKs**: Android package inspector with metadata, package verification, and native Android Package Installer dispatch via `navigator.share` (**Open With…**).
* **Personal Space (Vault)**:
  * Persistent IndexedDB storage (`mog_share_personal_vault`) automatically cataloging all received files.
  * Automatic category detection (`images`, `videos`, `audio`, `documents`, `apps`, `archives`, `other`).
  * Real-time search, sorting (date, size, name), and storage quota breakdown.
  * Multi-select batch actions and **Export All as ZIP** using `fflate`.

### 🚀 High-Performance Transfer Engine
* **True P2P WebRTC DataChannels**: 16 KB binary frames, low latency, chunked array buffers (no base64 overhead).
* **2-Layer Credit-Based Flow Control**: High-speed backpressure preventing buffer saturation on multi-gigabyte transfers.
* **Stream-to-Disk Storage**: Direct disk streaming on Chromium via File System Access API; graceful OPFS / in-memory fallback.
* **E2E Encrypted Relay Fallback**: PBKDF2 + AES-GCM encryption for server relay fallback and clipboard synchronization.
* **Resume & Integrity**: SHA-256 chunk verification and automatic resume journal for dropped connections.

### 🎨 Neo-Brutalist Design System
* **Odd Pale Palette**: Unique, premium color palette (`--pale-butter`, `--pale-mint`, `--pale-lavender`, `--pale-peach`, `--pale-cyan`, `--pale-rose`, `--pale-paper`).
* **Tactile Micro-Interactions**: Solid 2.5px dark ink borders, 4px hard offset drop shadows (`4px 4px 0px`), spring button press physics, and crisp monospace status indicators.
* **Mobile-First & Responsive**: Designed for one-handed thumb navigation with bottom tabs and haptic feedback.

---

## 🛠️ Tech Stack

* **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide Icons, QR Code, fflate
* **Signaling Server**: Node.js, Express, WebSocket (`ws`), TypeScript
* **Networking**: WebRTC DataChannels, STUN/TURN (coturn), Server-Sent Events (SSE) fallback
* **Persistence**: IndexedDB (Personal Space & Transfer History), localStorage
* **Testing**: Vitest (68 automated unit & integration tests)

---

## 🚀 Quickstart

### Prerequisites
* **Node.js**: v20+ or v22+
* **pnpm** (recommended) or **npm**

### Installation

```bash
# Clone the repository
git clone https://github.com/Loismybro/mog-share.git
cd mog-share

# Install workspace dependencies
pnpm install
```

### Running in Development

```bash
# Run both signaling server and web client concurrently
npm run dev
```

* **Web Client**: `http://localhost:5173`
* **Signaling Server**: `http://localhost:4000` (WebSocket at `/ws`)

> **Mobile testing on LAN**: Open the printed LAN URL (e.g. `http://192.168.1.x:5173`) on your mobile browser. Devices on the same Wi-Fi will appear in the Radar Scanner automatically within 3 seconds.

---

## 🏗️ Production Deployment

### Single-Origin Server (Recommended)
Compile the static web assets and run the Express + WebSocket server on one port:

```bash
# Build the production web bundle
npm run build

# Start the unified server (port 3000 or custom PORT)
PORT=3000 npm start
```

The server serves the web application at `/`, signaling WebSocket at `/ws`, API routes at `/api/*`, and the project ZIP archive at `/api/download-zip`.

### Deploy with Docker & Coturn
Self-host the signaling server along with a coturn TURN relay for strict NAT environments:

```bash
TURN_USER=mog TURN_PASS=secret-key docker compose up -d
```

---

## 🧪 Testing

MogShare includes a comprehensive test suite covering dual-stack discovery, peer negotiation, flow control, resume journals, E2E encryption, and Personal Space persistence:

```bash
npm test
```

```
Test Files  11 passed (11)
     Tests  68 passed (68)
```

---

## 🔒 Security & Privacy

* **Direct WebRTC**: Peer-to-peer data channels never transit through third-party servers.
* **Optional Passphrase**: Password-derived AES-GCM encryption ensures server-relayed chunks and clipboard items remain opaque even to relay operators.
* **Zero Cloud Storage**: Received files are stored locally in your browser's IndexedDB and never uploaded to external servers.

---

## 📄 License

MIT © MogShare Contributors
