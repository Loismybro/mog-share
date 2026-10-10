# Phase 0: Codebase Audit Report

Conducted across the codebase for items A1 through A20 per Section 1 of the ShareApp Rebuild Specification.

---

### A1: Whole file read into memory (readAsArrayBuffer/arrayBuffer on the entire file, or all chunks collected in an array then merged into one Blob)
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:835`: `const buf = await file.arrayBuffer();` reads the entire file (up to 64 MB) into memory for integrity hashing before transfer.
  - `packages/client/src/services/network.ts:1221, 1255, 1303`: Incoming chunks are accumulated into an in-memory array `job.chunks = new Array(totalChunks)`.
  - `packages/client/src/services/network.ts:1357`: `const blob = new Blob(job.chunks as ArrayBuffer[], ...);` merges all chunk buffers into an in-memory Blob.
  - `packages/client/src/services/network.ts:1362`: `await sha256Hex(await blob.arrayBuffer());` converts entire blob back into ArrayBuffer in memory.
  - `packages/client/src/App.tsx:413`: `const buf = await (await fetch(t.blobUrl!)).arrayBuffer();` loads entire completed file into memory for zip generation.
- **Planned Fix**: Wholesale replacement with streaming sender and receiver pipelines (sections 4.5, 4.6). The sender reads 4 MiB blocks on-demand using `fileread.worker`. The receiver streams blocks directly to disk via `filewrite.worker` using File System Access API (FSA) writable file stream or Origin Private File System (OPFS) SyncAccessHandle, or Service Worker streaming response. Memory fallback is restricted to files < 200 MB with explicit quota warning.

---

### A2: Sending Blobs or strings over the data channel instead of ArrayBuffer
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1037`: `dc.send(JSON.stringify({ kind: 'meta', ... }))` sends string metadata over the data channel.
  - `packages/client/src/services/network.ts:1065`: `dc.send(JSON.stringify({ kind: 'done' }))` sends string completion over the data channel.
  - `packages/client/src/services/network.ts:1125, 1141`: Relay fallback sends JSON strings with base64 data over WebSocket.
- **Planned Fix**: Implement binary framing protocol (sections 4.1, 4.2) using `DataView` with fixed big-endian binary headers (frame type, transferId, fileIndex, blockIndex, chunkIndex) and send ONLY `ArrayBuffer` payloads over the data channel with `dc.binaryType = 'arraybuffer'`. Separate control messages to dedicated `ctl` data channel (id 0) and binary data blocks to `data` data channel (id 1).

---

### A3: No check of dataChannel.bufferedAmount, or pacing done with setTimeout/setInterval instead of the bufferedamountlow event
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1045-1051`: Checks `dc.bufferedAmount > BUFFERED_HIGH` (4 MiB) but uses a fallback `setTimeout` and never configures `dc.bufferedAmountLowThreshold`.
  - `packages/client/src/services/network.ts:1136-1138`: Relay pacing uses `await new Promise((r) => setTimeout(r, 50))` instead of proper socket drain events/backpressure.
- **Planned Fix**: Implement two-layer flow control (section 4.4). Layer 1: set `dc.bufferedAmountLowThreshold = 256 * 1024` (256 KiB) and a high-water mark of 1 MiB. Await `bufferedamountlow` event whenever bufferedAmount exceeds 1 MiB, with NO timer-based pacing. Layer 2: application block credits (window of 4 blocks) granted by the receiver only after block verification and durable disk write.

---

### A4: Chunk size above 64 KiB, or a hardcoded chunk size with no negotiation against sctp.maxMessageSize
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:14-15`: Hardcoded `CHUNK_SIZE = 16 * 1024` and `RELAY_CHUNK_SIZE = 48 * 1024`.
- **Planned Fix**: Dynamic handshake negotiation (section 4.1) during `hello` exchange on `ctl` channel. Chunk size defaults to 16 KiB, negotiated up to 64 KiB only if both peers match compatible engines and pass a 2s self-test, clamped by `min(local sctp.maxMessageSize, remote sctp.maxMessageSize, 64 KiB)`. Constants placed in `packages/shared/constants`.

---

### A5: Unordered or maxRetransmits/maxPacketLifeTime data channels used for file data
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:924`: Dynamic channel creation per transfer `pc.createDataChannel('t-' + id, { ordered: true })`. While ordered is true, channels are unnegotiated, unaligned, and created dynamically per transfer leading to glare and race conditions.
  - `packages/client/src/services/network.ts:61`: Throwaway `pc.createDataChannel('discovery')` created with default parameters.
- **Planned Fix**: Per section 3.6, eliminate ad-hoc channels. Use pre-negotiated fixed channels (`negotiated: true`) with id 0 for `ctl` (ordered, reliable) and id 1 for `data` (ordered, reliable). Never specify `maxRetransmits` or `maxPacketLifeTime`.

---

### A6: ICE config with only a STUN server, only free public TURN, or hardcoded static TURN credentials in client code
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:28-43`: Hardcoded public STUN servers (`stun.l.google.com`, `stun.cloudflare.com`) and static credentials loaded from frontend build env variables `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS`.
- **Planned Fix**: Implement dynamic ephemeral TURN credential issuance on signaling server via coturn REST-style HMAC-SHA1 shared secret (section 3.7). Signaling server delivers ICE server configurations (stun:3478, turn:3478 udp/tcp, turns:5349 tcp, turns:443 tcp) with 24-hour TTL tokens on session init. Relay candidates gathered at t=0.

---

### A7: Server reading client IP from socket.remoteAddress / req.ip while behind a proxy (Nginx, Cloudflare, load balancer)
- **Status**: FOUND
- **Locations**:
  - `packages/server/src/index.ts:23`: `app.set('trust proxy', true)` blindly trusts all proxy headers from any client.
  - `packages/server/src/lib.ts:56-64`: `extractClientIp` takes `req.headers['x-forwarded-for'].split(',')[0]` without checking if the peer socket IP is in a trusted proxy CIDR block.
- **Planned Fix**: Implement trusted-proxy client IP extractor (section 3.2) in `apps/signaling/src/clientip/`. Verify socket peer IP against configurable `TRUSTED_PROXIES` CIDRs. If trusted, extract `CF-Connecting-IP` or the rightmost-untrusted entry of `X-Forwarded-For`. Otherwise use `socket.remoteAddress` and ignore all headers. Expose `/debug/whoami` for diagnostics.

---

### A8: Local-group matching that compares full IPv6 addresses, or only the one address family the connection arrived on
- **Status**: FOUND
- **Locations**:
  - `packages/server/src/lib.ts:46-48`: Bypasses matching when `STRICT_NETWORK_MATCHING !== 'true'`.
  - `packages/server/src/lib.ts:31-36`: Groups IPv6 by raw string prefix without dual-stack keys, and only matches whatever family the single connection used.
- **Planned Fix**: Dual-stack local group engine (section 3.3). Clients query both `/ip` (v4-only) and `/ip` (v6-only) probe endpoints plus STUN srflx second-opinion, deriving a key set (IPv4 full address + IPv6 /64 prefix). Keys are hashed with server HMAC secret salt. Server groups devices if their key sets overlap in ANY key. Group size capped at 24 with 15s disconnect grace period.

---

### A9: Both peers creating offers at the same time (glare), or no perfect-negotiation logic
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:942-953, 962-1003`: Ad-hoc `createOffer()` and manual signaling. No polite/impolite peer roles, no glare collision handling, no `onnegotiationneeded`.
- **Planned Fix**: Create standard `PeerSession` class (section 3.6) implementing the W3C Perfect Negotiation pattern. Lexicographically smaller device ID is polite. Polite peer rolls back on glare; impolite peer ignores colliding offer. All offers triggered solely by `onnegotiationneeded`.

---

### A10: ICE candidates added before setRemoteDescription finished (no queue)
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1020-1027`: Checks `job.pc && job.pc.remoteDescription` directly, but does not track in-flight `setRemoteDescription` async operations or promise queues, leading to dropped candidates and race conditions.
- **Planned Fix**: Implement dedicated candidate queue in `PeerSession` (section 3.6). Remote candidates arriving prior to or during `setRemoteDescription` execution are buffered and flushed sequentially only after `setRemoteDescription` promise resolves.

---

### A11: No handling of connectionState / iceConnectionState transitions (disconnected, failed), no ICE restart
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:938-940`: Only checks `failed` or `closed` on sender to immediately finish with null. Receiver has no connection state handler at all. No `restartIce()` implementation anywhere.
- **Planned Fix**: Comprehensive lifecycle handling in `PeerSession` (section 3.6). On `disconnected`: wait 4s, trigger `restartIce()` from impolite side. On `failed`: immediate ICE restart; escalate to server relay after 2 failures. On visibility, online, or network change: probe with ping on `ctl`, trigger ICE restart if no pong in 3s.

---

### A12: No heartbeat on the signaling WebSocket, no reconnect with backoff, or signaling state lost on reconnect
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:273-280`: Heartbeat ping has no 3-miss reconnect trigger.
  - `packages/client/src/services/network.ts:405-415`: Reconnection lacks transport ladder (no SSE+POST or long-polling).
  - `packages/server/src/index.ts:480-492, 517-520`: No resume tokens or missed message replay buffer (signaling messages sent during drops are permanently discarded).
- **Planned Fix**: Signaling transport ladder (section 3.5) with WS -> SSE+POST -> Long-polling. Application-level ping every 20s with 3-miss reconnect trigger. Exponential backoff with full jitter (500ms base, 15s cap). Resume token restores session state and replays last 60s / 200 missed messages.

---

### A13: Peer connections, channels, object URLs, and timers never cleaned up after a transfer ends
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1436-1449`: Incomplete cleanup: data channels on receiver not closed, created blob URLs are never revoked, no wake lock cleanup, timers can leak on abort.
- **Planned Fix**: Single centralized `close()` method in `PeerSession` and transfer sessions (section 3.6) that clears all timers, closes all channels and peer connections, revokes object URLs, releases wake lock, and detaches event listeners on any terminal state.

---

### A14: Transfer state kept only in memory (lost on tab sleep or reload)
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:178-182`: State tracked solely in in-memory Maps (`sendJobs`, `receiveJobs`).
- **Planned Fix**: Persistent IndexedDB transfer journal (section 4.8) recording transferId, file metadata, block size, verified blocks bitmap, negotiated settings, and peer key. Journal flushed on every acknowledged block, debounced to 1s, and flushed on pagehide/freeze.

---

### A15: No receiver acks, no integrity check, no resume
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1039-1065`: Sender blasts chunks without waiting for receiver acks or credits.
  - `packages/client/src/services/network.ts:1071-1080`: Any failure restarts the entire file from 0 via relay. No partial resume or block re-request.
- **Planned Fix**: Block-level credit flow control and receiver acknowledgments (sections 4.4, 4.7, 4.8). Receiver hashes each block upon receipt, verifies block SHA-256 hash against sender's `BLOCK_END` manifest, writes block to disk, returns credit/ack. On connection drop, resume protocol transmits only missing blocks based on bitmap.

---

### A16: Any use of HTTP (non-TLS) in production, or mixed content
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:308, 319`: Hardcoded HTTP/WS fallbacks `u.startsWith('http://') u = 'ws://' + u.slice(7)` and `wsUrl.replace(/^ws/, 'http')`.
- **Planned Fix**: Strict TLS enforcement (sections 3.1, 8). Enforce HSTS, secure contexts only, HTTPS/WSS across all production endpoints, strict Content-Security-Policy with connect-src restricted to approved TLS origins.

---

### A17: Receiver writes with an <a download> blob built from an in-memory array for files of any size
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1190, 1357, 1373`: Default for all files under 64MB and all non-Chromium browsers is to accumulate chunks in memory and create `blobUrl`.
  - `packages/client/src/App.tsx:396-402`: Downloads triggered via `a.href = t.blobUrl; a.click()`.
- **Planned Fix**: Tiered storage writer strategy (section 4.6): 1) File System Access API (Desktop Chromium) via worker stream, 2) OPFS SyncAccessHandle (Android, iOS Safari 15.2+, Firefox, macOS Safari) + share sheet/disk-backed URL, 3) Service Worker streaming download (`/__download/<id>`), 4) Memory only as absolute last resort for files < 200 MB with quota warning.

---

### A18: UI progress computed from bytes handed to send(), not from bytes acknowledged by the receiver
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:1060-1062, 1132-1134`: `sent += buf.byteLength; this.trackProgress(transfer, sent)` executed immediately after `send()`.
- **Planned Fix**: Track progress strictly from verified receiver block acknowledgments (sections 4.4, 7). Sender UI progress updates only when receiving `ACK` frames from receiver.

---

### A19: Anything that blocks the main thread: hashing, slicing, or file writing on the UI thread
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/services/network.ts:835`: `file.arrayBuffer()` and `sha256Hex()` on main thread.
  - `packages/client/src/services/network.ts:1053-1054`: `file.slice()` and `slice.arrayBuffer()` in send loop on main thread.
  - `packages/client/src/services/network.ts:1245`: `job.writer!.write(...)` on main thread.
  - `packages/client/src/services/network.ts:1362`: Whole-file verification hash on main thread.
- **Planned Fix**: Offload all CPU and I/O tasks to dedicated Web Workers (section 4.5): `fileread.worker` for file slicing and transferable buffer generation, `hash.worker` for block hashing (SHA-256 / BLAKE3), and `filewrite.worker` for disk writes. Main thread only handles message dispatch and UI rendering.

---

### A20: No Wake Lock and no handling of visibilitychange/pagehide
- **Status**: FOUND
- **Locations**:
  - `packages/client/src/App.tsx:305-319`: Requests WakeLock on mount but does not re-acquire on `visibilitychange` to `visible` (browser releases it automatically on hide).
  - `packages/client/src/services/network.ts:244-256`: Handles visibilitychange for basic reconnect but does not ping RTC channels, does not flush journals, lacks silent video keep-awake fallback for iOS.
- **Planned Fix**: Comprehensive platform lifecycle engine in `apps/web/src/platform/` (sections 3.6, 5): auto-reacquire Wake Lock on `visibilitychange` to visible, fallback to silent looping video keep-awake on iOS after user gesture, freeze/resume lifecycle handlers with channel probing (ping/pong) and IndexedDB journal flushes.
