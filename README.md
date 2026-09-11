<div align="center">

# ⚡ MOG-SHARE

### **The Open-Source AirDrop Killer. Built for Chads.**
*Cross-platform file sharing & universal continuity across **iOS, Android, Mac, Windows, Linux, and Web**.*

```
   ███╗   ███╗ ██████╗  ██████╗         ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗
   ████╗ ████║██╔═══██╗██╔════╝         ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝
   ██╔████╔██║██║   ██║██║  ███╗███████╗███████╗███████║███████║██████╔╝█████╗  
   ██║╚██╔╝██║██║   ██║██║   ██║╚══════╝╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  
   ██║ ╚═╝ ██║╚██████╔╝╚██████╔╝        ███████║██║  ██║██║  ██║██║  ██║███████╗
   ╚═╝     ╚═╝ ╚═════╝  ╚═════╝         ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
```

[![License: MIT](https://img.shields.io/badge/LICENSE-MIT-black?style=for-the-badge&logoColor=white)](LICENSE)
[![Protocol: P2P + LAN](https://img.shields.io/badge/LAN%20SPEED-120%20MB%2FS-FFC900?style=for-the-badge&logoColor=black)]()
[![Cloud Storage: 0%](https://img.shields.io/badge/CLOUD%20LOGS-0%25%20(100%25%20P2P)-00F59B?style=for-the-badge&logoColor=black)]()
[![Style: Neo-Brutalist](https://img.shields.io/badge/AESTHETIC-GUMROAD%20COLOURMAXXED-FF90E8?style=for-the-badge&logoColor=black)]()

</div>

---

## 💥 Why MOG-SHARE?

Apple keeps **AirDrop** locked inside their walled garden.  
Google and Samsung built **Quick Share**, but it locks out Apple and Linux users.  
**LocalSend** is cool, but it **only works if both devices are on the exact same Wi-Fi router** and forces everyone to pre-install an app.

**MOG-SHARE moggs all of them simultaneously:**
1. **⚡ Local Share (LAN Mesh)**: Blazing-fast direct Wi-Fi line-rate transfers (**up to 120 MB/s**). Works 100% offline with zero internet required.
2. **🌐 Online Share (WAN P2P)**: Transfer files to any device across 5G cell data or different cities via a **6-digit room code** (`MOG-XXX-XXX`) using direct WebRTC peer-to-peer data channels.
3. **📱 Zero-Install Guest Mode (Camera QR Scan)**: Sending a video to a friend who doesn't have the app? They scan your screen's QR code with their default iPhone or Android Camera app—Safari/Chrome instantly opens and streams the file directly to their downloads folder. No app installation needed.
4. **📋 Universal Clipboard Sync**: Copy on Mac/PC, hit broadcast, and paste immediately on your phone.
5. **🎨 Gumroad / Neo-Brutalist Aesthetic**: Built with bold black borders, hard drop shadows, punchy pastel accents, and tactile haptic audio clicks. Zero generic neon AI gradients.

---

## 🥊 The Mogging Matrix (Feature Comparison)

| Feature | Apple AirDrop | LocalSend | Quick Share | PairDrop | **MOG-SHARE** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **All Platforms (iOS, Android, Mac, Win, Linux)** | ❌ Apple only | ✅ | ❌ Android/Win | ✅ Web only | **👑 MOGS ALL** |
| **Same Wi-Fi Line-Rate (100% Offline)** | ✅ | ✅ | ✅ | ❌ (Needs internet) | **✅ 120 MB/s LAN** |
| **Cross-Network P2P (Anywhere in World)** | ❌ | ❌ | ❌ | ⚠️ Slow | **✅ WebRTC E2EE** |
| **Zero-Install Camera QR Mode for Guests** | ❌ | ❌ | ❌ | ✅ | **✅ Native Safari/Chrome** |
| **Universal Realtime Clipboard Sync** | ⚠️ (Apple only) | ❌ | ❌ | ❌ | **✅ Built-in** |
| **Cloud Storage / Surveillance** | 0% | 0% | Server-logged | 0% | **🔒 0% (Strict P2P)** |
| **Aesthetic Factor** | Corporate Gray | Flutter generic | Material | Flat Minimal | **🔥 Gumroad Colourmaxxing** |

---

## 🏗️ Architecture

```
                             ┌───────────────────────────────┐
                             │     MOG-SHARE Client (UI)     │
                             │  (React / Vite / Neo-Brutal)  │
                             └───────────────┬───────────────┘
                                             │
                      ┌──────────────────────┴──────────────────────┐
                      ▼                                             ▼
           [ Engine 1: Local Share ]                     [ Engine 2: Online Share ]
        • Same Wi-Fi / Hotspot / Subnet               • Cross-Network / Mobile 5G / Remote
        • Instant Auto-Discovery Mesh                 • WebRTC P2P DataChannels (STUN/TURN)
        • Up to 120 MB/s Line-Rate Sockets            • Ephemeral 6-Digit Code Exchange
        • 100% Offline (No Internet Needed)           • End-to-End Cryptography (E2EE)
```

---

## ⚡ Quickstart (Run in 30 Seconds)

### Prerequisites
- Node.js `v18+` or `v22+`
- npm `v9+`

### 1. Clone & Install
```bash
git clone https://github.com/your-username/mog-share.git
cd mog-share
npm install
cd packages/client && npm install
cd ../server && npm install
```

### 2. Boot the Entire Stack
```bash
# From the root mog-share directory:
npm run dev
```

MOG-SHARE boots both engines concurrently:
- 💻 **Web Client UI**: `http://localhost:5173`
- 📡 **Signaling & Discovery Node**: `ws://localhost:4000/ws`

Open `http://localhost:5173` on multiple devices or browser windows to watch them immediately detect each other on the radar!

---

## 📱 Platforms & Roadmap

- [x] **Web & PWA**: 100% complete with camera-scannable QR guest receiver for iOS Safari & Android Chrome.
- [x] **Universal Clipboard**: Instant encrypted text & URL broadcast.
- [x] **Local LAN Mesh**: High-speed auto-discovery & line-rate chunked streaming.
- [x] **Online P2P**: 6-digit room code generation & WebRTC signaling broker.
- [ ] **Windows & Linux Desktop**: Packaging via Tauri v2 single-executable binary (`.exe`, `.AppImage`, `.deb`).
- [ ] **Android Native**: Background discovery service & Quick Settings tile.
- [ ] **iOS Native**: ReplayKit Screen Broadcast extension & Share Sheet integration.

---

## 📄 License

MIT License. Free, open-source, and sovereign software for everyone.
