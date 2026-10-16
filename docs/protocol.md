# ShareApp Wire & Transfer Protocol Specification (v1.0.0)

This document defines the wire framing, signaling exchange, flow control, and end-to-end security protocols for ShareApp.

---

## 1. Signaling Protocol (JSON over WS / SSE / Long-Poll)

### 1.1 Message Envelope
Every signaling message uses the standard envelope:
```json
{
  "v": 1,
  "type": "string",
  "id": "string",
  "from": "optional_string",
  "to": "optional_string",
  "seq": 1,
  "payload": {}
}
```
- `v`: Protocol major version (must be 1).
- `type`: Message type discriminator (`join-local`, `joined-local`, `ping`, `pong`, `reconnect`, `resumed`, `signal`, `relay-frame`, `create-room`, `join-room`).
- `id`: Cryptographically unique message ID.
- `from` / `to`: Ephemeral device IDs.

### 1.2 Heartbeat & Presence
- Clients send `ping` every 20 seconds.
- Server returns `pong`.
- 3 consecutive misses triggers client reconnection.
- Presence is broadcast only after the initial heartbeat completes.

---

## 2. WebRTC Peer Session & Channels

### 2.1 Fixed Data Channels (`negotiated: true`)
Data channels avoid negotiation glare by using pre-negotiated IDs:
- **ID 0 (`ctl`)**: Ordered, reliable. Carries handshake, metadata, block hashes, acknowledgments, credits, and pause/resume control. `binaryType = "arraybuffer"`.
- **ID 1 (`data`)**: Ordered, reliable. Carries 17-byte framed binary data blocks. `binaryType = "arraybuffer"`.

### 2.2 Perfect Negotiation Pattern
- Peer with lexicographically smaller device ID is **polite**.
- Impolite peer ignores colliding offers; polite peer rolls back.
- Remote ICE candidates are queued until `setRemoteDescription` completes.

---

## 3. Binary Framing Layout

Binary data frames sent over `data` channel or server relay use a fixed 17-byte big-endian header:

```
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Frame Type   |               Transfer ID (uint32)            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     File Index (uint32)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Block Index (uint32)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                Chunk Index within Block (uint32)              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Payload ...                           |
```

- **Frame Types**:
  - `DATA = 1`
  - `BLOCK_END = 2`
  - `EOF = 3`

---

## 4. Two-Layer Flow Control

1. **Layer 1 (Transport Backpressure)**:
   - `bufferedAmountLowThreshold` is set to 256 KiB.
   - High-water mark is 1 MiB.
   - If `dc.bufferedAmount > 1 MiB`, senders await `bufferedamountlow`.

2. **Layer 2 (Application Block Credits)**:
   - Receiver grants sender a credit window (default 4 blocks = 16 MiB).
   - Sender stops reading new blocks when credits reach 0.
   - Receiver returns 1 credit only after block SHA-256 hash matches and block is written to disk.

---

## 5. Security & Trust Layer

### 5.1 Short Authentication String (SAS)
To prevent signaling MITM, both peers compute:
```
SAS = SHA-256("SAS:" + sorted(dtlsFingerprintA, dtlsFingerprintB) + ":" + sorted(ecdhPubA, ecdhPubB))
```
- Formatted as 4 digits and 3 emoji for user visual comparison.

### 5.2 Server Relay E2E Encryption
- Encrypted with AES-256-GCM using key derived from ECDH exchange.
- Frame layout: `[12-byte IV][Ciphertext + 16-byte Auth Tag]`.
- The signaling server sees only opaque ciphertext.
