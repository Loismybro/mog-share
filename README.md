<div align="center">

# ⚡ MOG-SHARE

### **The Open-Source AirDrop Killer. Built for Chads.**
*Share gigabytes between iPhone, Android, Mac, Windows, and Linux in seconds. No cloud. No accounts. No paywalls. No walled gardens.*

```
   ███╗   ███╗ ██████╗  ██████╗         ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗
   ████╗ ████║██╔═══██╗██╔════╝         ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝
   ██╔████╔██║██║   ██║██║  ███╗███████╗███████╗███████║███████║██████╔╝█████╗  
   ██║╚██╔╝██║██║   ██║██║   ██║╚══════╝╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  
   ██║ ╚═╝ ██║╚██████╔╝╚██████╔╝        ███████║██║  ██║██║  ██║██║  ██║███████╗
   ╚═╝     ╚═╝ ╚═════╝  ╚═════╝         ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
```

[![License: MIT](https://img.shields.io/badge/LICENSE-MIT-131722?style=for-the-badge&logoColor=white&labelColor=000)](LICENSE)
[![Protocol: P2P + LAN](https://img.shields.io/badge/LAN%20SPEED-120%20MB%2FS-FFC900?style=for-the-badge&logoColor=000&labelColor=000)]()
[![Cloud Storage: 0%](https://img.shields.io/badge/CLOUD%20STORAGE-0%25%20(100%25%20P2P)-00F59B?style=for-the-badge&logoColor=000&labelColor=000)]()
[![E2EE: Direct Streams](https://img.shields.io/badge/PRIVACY-ZERO%20LOGS-60A5FA?style=for-the-badge&logoColor=000&labelColor=000)]()
[![Aesthetic: Neo-Brutalist](https://img.shields.io/badge/AESTHETIC-GUMROAD%20COLOURMAXXED-FF90E8?style=for-the-badge&logoColor=000&labelColor=000)]()

<br/>

[**Live Demo**](https://github.com/Loismybro/mog-share) • [**Why It Mogs**](#-why-mog-share) • [**Quickstart (30s)**](#-quickstart-run-in-30-seconds) • [**How It Works**](#-how-it-actually-works) • [**Mogging Matrix**](#-the-mogging-matrix) • [**Roadmap**](#-roadmap)

</div>

---

## 📺 Demo Preview

<!-- VIDEO_DEMO_START -->
<div align="center">

[![MOG-SHARE Demo Video](https://img.shields.io/badge/▶%20WATCH%20DEMO-COMING%20SOON-FFC900?style=for-the-badge&logo=youtube&logoColor=black)](https://github.com/Loismybro/mog-share)

```
+---------------------------------------------------------------+
|                                                               |
|    [ 🎬 VIDEO DEMO PLACEHOLDER: DROPPING HERE SOON! ]        |
|                                                               |
|    Watch 5GB fly between an Android phone and a MacBook       |
|    in under 30 seconds with 0 cloud servers in between.       |
|                                                               |
+---------------------------------------------------------------+
```

> 💡 **Demo video dropping soon!** Recorded live showing 120 MB/s local Wi-Fi radar discovery, camera QR zero-install guest mode, and cross-network 6-digit room sharing.

</div>
<!-- VIDEO_DEMO_END -->

---

## 💥 Why MOG-SHARE?

Every file transfer tool today has a catch:

- **Apple AirDrop** is trapped in Tim Cook's $1,200 walled garden. Try sending a 4K video from your iPhone to a Windows PC or Linux desktop. Good luck.
- **Quick Share / Nearby Share** locks out Apple and Linux users.
- **LocalSend** is cool, but **fails the second you leave your living room Wi-Fi** and forces everyone to install an app before you can send a single byte.
- **WeTransfer & Google Drive** upload your private vacation photos to corporate cloud servers, cap your file sizes, and make you wait 10 minutes for links to expire.

### Enter MOG-SHARE.
One click. Any OS. Zero installs for friends.

```
       YOU (MacBook / PC)                     FRIEND (iPhone / Android)
    ┌────────────────────────┐              ┌────────────────────────┐
    │   Select 4K Video      │   6-digit    │  Point Phone Camera    │
    │   (Drop on Radar)      │ ───────────> │  Tap Pop-up Link       │
    │   Click "Send"         │     code     │  File Drops in Downloads│
    └────────────────────────┘              └────────────────────────┘
                 ▲                                       │
                 └──────────── Direct P2P Stream ────────┘
                             (100% Offline LAN / E2EE)
```

1. **⚡ Local Share (LAN Radar)**: Automatic zero-config discovery over your local Wi-Fi or hotspot. Streams at full router line-rate (**up to 120 MB/s**). Completely works with your internet router unplugged from the wall.
2. **🌐 Online Share (Cross-Network Rooms)**: Friend is on mobile 5G or in another country? Give them a **6-digit room code** (e.g. `748-291`) or send a magic link. Direct end-to-end chunk streaming without size limits.
3. **📱 Zero-Install Guest Mode (Camera QR Scan)**: Need to give files to someone who doesn't have MOG-SHARE? Show them the on-screen QR code. They point their native iOS Camera or Android Google Lens—Safari/Chrome immediately opens and starts downloading. No App Store, no signup, no friction.
4. **📋 Universal Real-Time Clipboard**: Copy a link or password on your desktop, hit broadcast, and it pops right up as a toast on your phone.
5. **🛡️ Rock-Solid Mobile Engine**: Engineered with a **60-second mobile disconnect grace period** and **backpressure streaming**. Switch to your photo gallery, pick 20 high-res camera photos, and your session never drops or restarts.

---

## 🥊 The Mogging Matrix

| Feature | Apple AirDrop | LocalSend | Quick Share | WeTransfer | **MOG-SHARE** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **All OSes (iOS, Android, Mac, Win, Linux)** | ❌ Apple only | ✅ | ❌ No iOS/Mac | ⚠️ Web only | **👑 MOGS ALL** |
| **Zero App Install (Guest Camera Scan)** | ❌ | ❌ (Must install) | ❌ | ⚠️ Cloud only | **✅ Native Web API** |
| **Offline LAN Speed (No Internet Needed)** | ✅ | ✅ | ✅ | ❌ Needs Wi-Fi | **✅ Up to 120 MB/s** |
| **Cross-Network / Cell Data P2P** | ❌ | ❌ (Same LAN only)| ❌ | ⚠️ Capped & Slow | **✅ 6-Digit Rooms** |
| **File Size Limit** | Uncapped | Uncapped | Uncapped | 2 GB free cap | **♾️ Unlimited** |
| **Cloud Surveillance / Storage** | 0% | 0% | Logs metadata | 100% on cloud | **🔒 0% (Pure P2P)** |
| **Universal Clipboard Sync** | Apple only | ❌ | ❌ | ❌ | **✅ Built-in Toast** |
| **Design Language** | Plain gray | Flutter generic | Material UI | Ad-bloated web | **🔥 Neo-Brutalist** |

---

## ⚡ Quickstart (Run in 30 Seconds)

### 1. Clone & Run
```bash
# Clone the repo
git clone https://github.com/Loismybro/mog-share.git
cd mog-share

# Install dependencies
npm install
npm install --prefix packages/server
npm install --prefix packages/client

# Fire up both Server & Client concurrently
npm run dev
```

### 2. Access Your Hub
- 💻 **Web Client UI**: `http://localhost:5173`
- 📡 **Signaling & P2P Broker**: `ws://localhost:4000/ws`
- 🩺 **Health Diagnostics**: `http://localhost:4000/api/health`

Open `http://localhost:5173` on two browser tabs or on another laptop on your Wi-Fi—watch them instantly ping each other on the live radar!

---

## 🌐 Share With Anyone Outside Your House

Want to send files across 5G cellular or to a friend across the globe? Run a quick Cloudflare or ngrok tunnel:

```bash
# Using Cloudflare Tunnel (Free, zero setup)
cloudflared tunnel --url http://localhost:5173
```

Copy the generated `https://xxxx.trycloudflare.com` URL, send it to your friend (or let them scan the QR code), enter your 6-digit room code, and transfer whatever you want!

---

## 🧠 How It Actually Works

MOG-SHARE does not upload your files to AWS S3, Google Cloud, or any central database. Ever.

```
                    ┌────────────────────────────────────┐
                    │      MOG-SHARE CLIENT ENGINE       │
                    │   (React 19 + TypeScript + Vite)   │
                    └─────────────────┬──────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
    [ ENGINE 1: LOCAL RADAR ]                     [ ENGINE 2: ONLINE ROOMS ]
    • Broadcasts IP & Hardware Profile            • Ephemeral 6-Digit Code Broker
    • Auto-detects local LAN peers                • 60s Mobile Disconnect Grace Window
    • Streams 64KB raw binary chunks              • Automatic URL Hash Routing (#room=...)
    • 100% Offline line-rate transfers            • End-to-End Encrypted Transfer
```

### The Secret Sauce: Mobile-First Engineering
Mobile web browsers are notorious for killing background tabs the second you open the camera roll. Most web file-sharing apps crash and burn here.
- **60-Second Disconnect Grace Period**: When Android or iOS sleeps your browser tab to open the native Gallery, MOG-SHARE's server keeps your room alive. When you pick your files and return, your session seamlessly resumes in milliseconds.
- **Adaptive Backpressure Throttling**: Checks `ws.bufferedAmount` in real-time. If the receiver's connection is slower than your upload, the sender throttles itself to prevent browser memory spikes and tab crashes.
- **Direct Uint8Array Chunk Staging**: Incoming chunks are decoded straight into typed memory arrays—eliminating memory bloat and enabling instant file assembly upon completion.

---

## 🎨 Design Philosophy: Neo-Brutalist & Tactile

We are sick and tired of sterile corporate dashboards with identical purple-to-blue AI gradients.

MOG-SHARE is styled with:
- **Bold 3px black borders & hard isometric drop shadows** (`#000`)
- **Vibrant high-contrast palette**: Cyberpunk Yellow (`#FFC900`), Mint Green (`#00F59B`), Electric Pink (`#FF90E8`), Soft Cobalt (`#60A5FA`)
- **Synthesizer Haptic Audio**: Crisp retro arcade dings and pops synthesized in pure Web Audio API without heavy `.mp3` assets.
- **Tactical HUD Radar**: Real-time rotating sonar beam that visually plots nearby devices based on platform.

---

## 🗺️ Roadmap

- [x] **Universal Web Client**: Works in Safari, Chrome, Firefox, Brave, Edge, Samsung Internet.
- [x] **Local LAN Discovery**: Line-rate offline Wi-Fi transfers (120 MB/s).
- [x] **Online P2P Rooms**: 6-digit codes (`XXX-XXX`) with QR camera scan.
- [x] **Universal Clipboard Sync**: Instant encrypted clipboard broadcast across devices.
- [x] **Mobile Grace Period**: Immune to Android/iOS file picker tab sleep.
- [ ] **Native Desktop Shells**: Lightweight single-binary `.exe`, `.dmg`, and `.AppImage` via Tauri v2.
- [ ] **Android Background Daemon**: Notification shade quick-tile for instant background receives.
- [ ] **Folder Transfers & ZIP Bundling**: Drag an entire folder and stream it on the fly.
- [ ] **End-to-End Password Lock**: Optional password protection for high-security room transfers.

---

## 🤝 Contributing

Contributions are what make the open-source community so awesome. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">

**MOG-SHARE** — Built by hackers, for hackers.  
*Star ⭐ the repo if this saved you from Apple's ecosystem trap!*

</div>
