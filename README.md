# MOG-SHARE v2.0 ⚡

Fast, private, cross-platform file transfer for modern browsers and mobile devices. Share photos, videos, and documents directly between iOS, Android, macOS, Windows, and Linux.

---

## 🚀 Key Features

- **🌐 Primary Discovery via Network IP Grouping**: Devices on the same Wi-Fi network discover each other automatically without third-party public MQTT leaks.
- **🔒 True P2P WebRTC DataChannels**: Files stream directly browser-to-browser in 16 KB binary chunks with backpressure control (`bufferedAmountLowThreshold`).
- **🛡️ Fallback WebSocket Relay**: If strict corporate firewalls or symmetric NATs block WebRTC, files automatically fall back to the secure server relay with a clear "Relayed (slower)" badge.
- **🔢 Server-Governed 6-Digit Rooms**: Create temporary rooms with cryptographically secure numeric codes (`crypto.randomInt`). Rate-limited to prevent brute-force attacks, with automatic host handover and TTL pruning.
- **📱 Zero-Install QR & Mobile Links**: Open rooms instantly by scanning the generated QR code or copying the magic link with LAN IP priority.
- **📋 Universal Clipboard Sync**: Sync notes, links, and text snippets across devices with HTTP `execCommand` fallbacks.
- **⚡ Mobile Resilience**: 60-second connection grace period, screen wake lock during transfers, and automatic reconnection on visibility and online events.
- **🎨 Refined Modern UI**: Mobile-first design system with 16px soft-radius cards, dark and light themes, touch targets ≥ 44px, and clean status indicators.
- **📦 Multi-File Queue & ZIP Export**: Queue multiple files, accept all in one click, and download received files individually or as a single `.zip` bundle using `fflate`.
- **🛡️ Safety & Integrity**: File integrity verification (received chunk count and total size checking), filename sanitization, and warning banners for executable files.

---

## ⚡ Quickstart

### 1. Requirements
- Node.js 20.19+ or 22+ (LTS recommended)
- npm 10+

### 2. Install & Start Development Servers
```bash
# Clone the repository
git clone https://github.com/Loismybro/mog-share.git
cd mog-share

# Install all workspace dependencies
npm install

# Run both the signaling server and Vite client concurrently
npm run dev
```

- **Web Client**: `http://localhost:5173`
- **Signaling & Relay Server**: `http://localhost:4000` (WebSocket at `ws://localhost:4000/ws`)
- **System Diagnostics**: `http://localhost:4000/api/health`

### 3. Open on a Mobile Device
To open from a phone or another laptop on your Wi-Fi:
1. Find your computer's local IP (e.g. `192.168.1.100` or check the Diagnostics button in the app).
2. Open `http://192.168.1.100:5173` in your phone's browser.
3. Both devices will immediately see each other in **Nearby Devices**!

---

## 🧪 Running Tests

The test suite runs real integration and unit tests using Vitest covering network key computation, join rate limiting, room lifecycles, and health endpoints:

```bash
npm test
```

---

## 🚢 Deployment Guide

### Option A: Frontend on Vercel / GitHub Pages + Server on Render

1. **Deploy Server to Render / Fly.io**:
   - Create a Web Service pointing to `packages/server`.
   - Set Build Command: `npm install`
   - Set Start Command: `npx tsx src/index.ts`
   - Set Environment Variable: `PORT=10000` (or Render's default).
   - *Note on Free-Tier Cold Starts*: Render free instances sleep after 15 minutes of inactivity and take 30–50 seconds to wake up. MOG-SHARE automatically pings `/api/health` on startup and displays "Waking up server..." in the connection indicator.

2. **Deploy Frontend to Vercel / Cloudflare Pages**:
   - Root directory: repository root.
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Environment Variable: `VITE_WS_URL=wss://your-render-service.onrender.com/ws`

### Option B: Self-Hosting with Docker & Coturn

Run the complete stack (server + client + STUN/TURN server) with Docker Compose:

```bash
docker-compose up -d
```

Access the application at `http://localhost:4000`.

---

## 🔐 Architecture & Security

- **Discovery Grouping**: The server computes a `networkKey` from the client's public IP prefix (first 4 hextets `/64` for IPv6, full IP for IPv4). Devices only receive discovery events and presence for their matching subnet.
- **Zod Validation**: Every inbound WebSocket payload is validated against a strict schema with bounded string lengths and platform enums.
- **Rate Limiting**: Room join attempts are restricted to 5 attempts per minute per IP to prevent room code enumeration.
- **WebRTC DataChannels**: Peer-to-peer data channels use 16 KB chunks to ensure cross-browser compatibility between Chromium, Firefox, and Safari/WebKit.
- **Backpressure Monitoring**: Streaming pauses when `bufferedAmount` exceeds 4 MB and resumes on the `bufferedamountlow` event.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
