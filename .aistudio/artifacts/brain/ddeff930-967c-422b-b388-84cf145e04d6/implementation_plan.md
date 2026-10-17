# LocalSend-Inspired High-Speed P2P Transfer Engine & Batch Session Architecture

We are re-architecting the transfer engine to eliminate the 100–300 KB/s speed bottleneck and multi-file stalls by adopting LocalSend Protocol v2's session-based `prepare-upload` model, enforcing strict device-to-device P2P routing without premature cloud relay spillover, and offloading file slicing, binary framing, and hardware-accelerated SHA-256 verification to dedicated Web Workers.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions combine your confirmed preferences with LocalSend Protocol v2 optimizations:

- **Confirmed Decision 1 — Strict P2P First (Zero Premature Server Spillover)**: When a direct WebRTC DataChannel or same-device BroadcastChannel is active on Local LAN or Hotspot, 100% of file chunks stay strictly on the local P2P link. We remove the "hybrid spillover" that previously diverted frames over the cloud WebSocket relay whenever the WebRTC buffer reached 2.5 MiB—which was throttling transfers down to cloud upload speeds (100–300 KB/s). The server relay is used **only** if direct P2P negotiation genuinely fails or for cross-network Online Rooms where NAT traversal cannot establish a direct path.
- **Confirmed Decision 2 — LocalSend-Inspired `prepare-upload` Batch Session & Sequential Queue**: Inspired by LocalSend's `/prepare-upload` protocol, selecting multiple files sends a single unified **Batch Session Request** (`sessionId` + manifest of `files` with sizes and metadata) instead of flooding the signaling channel with concurrent per-file requests and retry intervals. Accepting the prompt once issues session authorization tokens for all files in the batch and streams them sequentially one by one at full bandwidth with zero lock or ACK contention.
- **Confirmed Decision 3 — Web Workers, Hardware WebCrypto & Event-Driven Backpressure**: File slicing (`Blob.slice().arrayBuffer()`), binary packet framing, block reassembly, and hardware-accelerated `crypto.subtle.digest('SHA-256')` run inside dedicated Sender and Receiver Web Workers. Instead of pausing after every 1 MiB block to wait for a round-trip ACK, the pipeline uses a deep sliding window (16 blocks / 64 MiB in flight) governed by native WebRTC `bufferedAmountLowThreshold` events so the hardware link stays continuously saturated at 60fps UI responsiveness.

---

## 1. Overview & Core Concept

- **What It Does**: Delivers a high-throughput, zero-stall peer-to-peer file sharing system across Local Wi-Fi, Mobile Hotspots, and Online Rooms with instant multi-file batch acceptance and hardware-accelerated off-thread streaming.
- **Target Audience / Persona**: Users sharing large videos, photo batches, and archives between phones, tablets, and desktops over local hotspots, home routers, or remote room codes who expect native LocalSend-class speeds (15–80+ MB/s on LAN) and zero UI lag.
- **Key Value**: Eliminates cloud server bandwidth bottlenecks during local transfers, prevents second and third files from stalling in multi-file selections, and utilizes client RAM, multi-core CPU Web Workers, and hardware WebCrypto instructions.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Multi-File Selection & LocalSend-Style Batch Session Initiation**: When a sender selects multiple files and taps a discovered device (or Online Room peer), the app bundles all selected files into a single `prepare-upload` session manifest with a shared `sessionId`. All files immediately appear in the sender's transfer queue: File 1 transitions to `Waiting for approval` (and then `Transferring`), while Files 2..N display a clean `Queued · #2 in batch` status without firing redundant network retry timers.
  2. **Unified Batch Receive Prompt**: On the receiving device, the incoming modal displays either a single file or a **Batch Transfer Summary** (showing total file count, combined byte size, expandable file list, and a single **Accept All** / **Decline** action, plus automatic acceptance if the sender is already marked as a trusted peer in the current session).
  3. **Zero-Stall Sequential Streaming**: Once accepted, the receiver returns a batch session acceptance containing per-file session tokens. File 1 immediately streams at peak speed. The instant File 1 completes verification and triggers download, File 2 automatically starts streaming over the already-warmed P2P channel with zero handshake delay.
- **Visual Identity & Theme**:
  - **Aesthetic Direction**: High-craft dark utilitarian telemetry interface paired with clean, scannable transfer rows and zero visual clutter.
  - **Color Palette & Mood**: Deep slate canvas (`#0F172A` / `--background`), elevated dark surface rows (`#1E293B`), crisp alabaster primary typography (`#F8FAFC`), emerald nominal indicators (`#16A34A`) for verified direct P2P links, amber (`#D97706`) for cloud-relayed fallback routes, and crimson (`#DC2626`) for integrity or quota alerts.
  - **Typography & Hierarchy**: Display headers in crisp geometric sans, dense scannable transfer filenames with middle truncation, and strict `tabular-nums` monospace numerals (`JetBrains Mono`) for live transfer speeds (`MB/s`), byte counters, and ETA timers so numbers never jitter during high-frequency updates.
  - **Component Styling & Layout**: Single-elevation transfer rows with 1px structural borders, clear unboxed inline metadata separated by middle dots (`Direct P2P · 42.8 MB/s · 3s left`), and an aggregate batch progress bar when multiple files are active.
- **Interactive Feedback & Motion**:
  - Throttled UI progress updates (every 120ms via `requestAnimationFrame` coalescing) so the main thread never stutters even when Web Workers process thousands of 64 KiB chunks per second.
  - Immediate visual transition from `Queued` to `Transferring` to `Completed` with automatic browser download triggering for every file in a multi-file batch.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Removing Hybrid Server Spillover on Open P2P Channels**
  - *Chosen Approach*: When WebRTC DataChannels are open, never spill overflow frames onto the WebSocket server relay. Instead, rely on native SCTP `bufferedAmountLowThreshold` (set to 512 KiB with a 4 MiB high watermark across the parallel DataChannels) to pace the Sender Worker directly against the physical Wi-Fi/Hotspot link capacity.
  - *Why*: Previously, whenever the fast local reader filled 2.5 MiB of WebRTC buffer, excess chunks were diverted to the cloud WebSocket server. That forced local LAN transfers through the hosting server's internet uplink and caused severe out-of-order block stalls and 100–300 KB/s speeds.
  - *Alternatives Considered*: Simultaneous P2P + server striping, which was rejected because cloud relay latency is 10–50× slower than local Wi-Fi and causes head-of-line blocking during block reassembly.
- **Decision 2: LocalSend Protocol v2 `prepare-upload` Session Handshake**
  - *Chosen Approach*: Replace per-file `request-transfer` / 1.5s retry loops with a session-level `prepare-upload` control handshake carrying `sessionId` and an array of file descriptors (`fileId`, `name`, `size`, `type`, `lastModified`). The receiver pre-registers `FileReceiverPipeline` instances for the entire session and responds with a single `prepare-upload-response` containing accepted `fileId -> token` mappings.
  - *Why*: Eliminates signaling storms when sending 5–50 files at once, allows a single user click to authorize the entire batch, and ensures the receiver has already initialized each file's receiver state before the first binary frame of File 2 arrives.
  - *Alternatives Considered*: Individual per-file prompts, which caused race conditions in `activeReceivers` lookup and dropped early chunks of subsequent files.
- **Decision 3: Continuous Sliding-Window Streaming vs. Stop-and-Wait Block ACKs**
  - *Chosen Approach*: Increase block size to 4 MiB (`DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024`) and credit window to 16 blocks (`DEFAULT_CREDIT_WINDOW_BLOCKS = 16`), allowing up to 64 MiB in flight while streaming 64 KiB chunks continuously driven by WebRTC buffer drain events. Hardware `crypto.subtle.digest('SHA-256')` verifies blocks asynchronously inside the Worker without pausing chunk transmission.
  - *Why*: Stop-and-wait per 1 MiB block introduced a full round-trip pause every few milliseconds, preventing TCP/SCTP congestion windows from ever reaching peak LAN throughput.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        UI Layer (Main Thread - 60fps)                        │
│  ┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │ Peer Radar & Room View  │  │ Batch Receive Modal  │  │ Transfer Queue  │  │
│  │ (LAN / Hotspot / Room)  │  │ (Accept All / Files) │  │ (Tabular Speed) │  │
│  └────────────┬────────────┘  └──────────┬───────────┘  └────────▲────────┘  │
└───────────────┼──────────────────────────┼───────────────────────┼───────────┘
                │                          │                       │
                ▼                          ▼                       │ (120ms UI
┌──────────────────────────────────────────────────────────────────┴───────────┐
│                Session & Transport Orchestrator (NetworkService)             │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ LocalSend Session Manager          │  │ Strict P2P Transport Router    │  │
│  │ • prepare-upload (sessionId,files) │  │ 1. BroadcastChannel (Same Tab) │  │
│  │ • Batch token issuance & pre-init  │  │ 2. 4x WebRTC DataChannels (P2P)│  │
│  │ • Sequential 1-by-1 file scheduler │  │ 3. WS Binary Relay (Fallback)  │  │
│  └─────────────────┬──────────────────┘  └───────▲───────────────┬────────┘  │
└────────────────────┼─────────────────────────────┼───────────────┼───────────┘
                     │ (Transferable ArrayBuffers) │               │
         ┌───────────▼──────────────┐              │   ┌───────────▼───────────┐
         │   Sender Web Worker      │──────────────┘   │  Receiver Web Worker  │
         │ • 4 MiB Slice Reader     │                  │ • Zero-Copy Chunk Map │
         │ • Hardware SHA-256       │                  │ • Hardware SHA-256    │
         │ • 64 KiB Frame Encoder   │                  │ • OPFS / RAM Stream   │
         └──────────────────────────┘                  └───────────────────────┘
```

### Data Model & State

- **`BatchUploadSession` (`prepare-upload`)**:
  - `sessionId`: Unique identifier for a multi-file or single-file transfer batch.
  - `senderDevice`: Sender identity, platform, model, and public key for optional relay encryption.
  - `files`: Ordered list of file descriptors (`transferId`, `fileIndex`, `name`, `size`, `type`, `lastModified`).
  - `tokens`: Map of `transferId -> sessionToken` returned by the receiver when accepting the batch.
- **Worker Message Protocol**:
  - Uses zero-copy `postMessage(buffer, [buffer])` `Transferable` `ArrayBuffer` ownership transfer between the Main Thread transport sockets and the Sender/Receiver Web Workers so file bytes are never cloned across threads.
- **Receiver Frame Buffer & Pre-Registration**:
  - All files in an accepted batch are registered in `activeReceivers` by their 32-bit `transferIdNum` immediately upon batch acceptance (or any early frames arriving before pipeline creation are buffered in a short-lived `earlyFrameBuffer` keyed by `transferIdNum` and replayed the instant the receiver pipeline initializes), guaranteeing zero dropped opening chunks on File 2..N.

### Interactive Component & State Mapping

1. **Batch Selection & `sendFiles(peer, files[])`**:
   - Validates non-empty file list, creates `TransferFile` state entries for all files (`waiting` for File 1, `queued` for Files 2..N), and dispatches a single `prepare-upload` control envelope containing the full file manifest.
   - If the user invokes `sendFile(peer, file)` for a single file, it seamlessly routes through the same session pipeline as a 1-file batch.
2. **Batch Receive Modal (`ReceiveModal`)**:
   - Displays single-file details or a multi-file batch summary (total files, combined size, scrollable list of file names and sizes).
   - Clicking **Accept** (or **Accept All**) calls `respondToBatchRequest(requests, true)`, which checks aggregate storage quota, pre-creates the receiver pipelines for every file in the batch, and sends a single `accept-batch-transfer` control response.
3. **Sequential File Pump & Backpressure Loop**:
   - The sender queue starts File 1 immediately upon batch acceptance.
   - The Sender Worker slices 4 MiB blocks, computes hardware SHA-256 via `crypto.subtle.digest`, and emits 64 KiB binary frames.
   - `PeerSession` monitors `RTCDataChannel.bufferedAmount` across the 4 parallel unordered DataChannels using native `onbufferedamountlow` callbacks (`bufferedAmountLowThreshold = 256 KiB` per channel) to pause/resume the Worker without `setTimeout` polling or cloud spillover.
   - As soon as File 1 receives its final block verification, it transitions to `completed`, releases its Worker buffers, and immediately triggers File 2 in the sequential queue.
