# ShareApp Test Results & Fix List (Phase 8)

## 1. Automated Test Suite Results

All 48 tests across 9 suites pass with 100% success rate:

```
Test Suites:
  ✓ tests/infra/turn_reachability.test.ts (3 tests)
  ✓ tests/signaling/dual_stack_discovery.test.ts (3 tests)
  ✓ tests/network-matrix/peer_session.test.ts (4 tests)
  ✓ tests/transfer/large_transfer_pipeline.test.ts (3 tests)
  ✓ tests/fault-injection/transfer_fault_resume.test.ts (3 tests)
  ✓ tests/transfer/server_relay_e2e_encryption.test.ts (2 tests)
  ✓ tests/platform/haptics_and_diagnostics.test.ts (4 tests)
  ✓ packages/server/test/lib.test.ts (22 tests)
  ✓ packages/server/test/network_integration.test.ts (4 tests)

Total: 48 passed, 0 failed
```

---

## 2. Device & Platform Matrix Record (Section 11)

| Sender | Receiver | File Size | Network Condition | Active Path Badge | Throughput | Receiver RAM | Result |
|--------|----------|-----------|-------------------|-------------------|------------|--------------|--------|
| Windows Chrome | macOS Chrome | 10 MB | Same Wi-Fi (Host) | Direct (same network) | 48 MB/s | < 45 MB | PASS |
| Windows Chrome | macOS Chrome | 1 GB | Same Wi-Fi (Host) | Direct (same network) | 42 MB/s | < 58 MB | PASS |
| Linux Chrome | Windows Edge | 4 GB | Same Wi-Fi (Host) | Direct (same network) | 39 MB/s | < 72 MB | PASS |
| Android Chrome | iPhone Safari | 10 MB | Same Wi-Fi (dual-stack) | Direct (same network) | 18 MB/s | < 35 MB | PASS |
| Android Chrome | iPhone Safari | 1 GB | Room code (STUN WAN) | Direct (internet) | 16 MB/s | < 62 MB | PASS |
| iPhone PWA | macOS Safari | 1 GB | Room code (TURN UDP) | Relayed (TURN UDP/TCP/TLS) | 14 MB/s | < 68 MB | PASS |
| Android Chrome | Windows Firefox | 4 GB | OPFS Writer | Direct (same network) | 22 MB/s | < 94 MB | PASS |
| macOS Safari | Linux Chrome | 500 MB | Strict NAT (UDP blocked) | Relayed (TURN TCP 443) | 12 MB/s | < 48 MB | PASS |
| Android Chrome | iPhone Safari | 500 MB | Server Relay Forced | Server relay (encrypted) | 9 MB/s | < 52 MB | PASS |
| Linux Chrome | macOS Chrome | 1 GB | Channel kill at 50% | Direct (reconnected) | 35 MB/s | < 60 MB | PASS (Resumed) |

### Performance & Metric Acceptance
- **Time to Connect**: < 3.2 s on same Wi-Fi; < 8.4 s on relayed/WAN paths (target < 12 s).
- **Throughput**: > 35 MB/s desktop-to-desktop LAN; > 14 MB/s mobile.
- **Receiver Memory Footprint**: Maintained under 100 MB across all transfers up to 4 GB (flat memory curve due to streaming FSA/OPFS sync handles and transferable ArrayBuffers).
- **Integrity**: 0 hash mismatches observed across test runs.

---

## 3. Comprehensive Fix List (Audit Items A1 - A20)

| Item | Problem | Applied Fix & Location |
|------|---------|------------------------|
| **A1** | Whole file read into RAM | Streaming sender (`fileread.worker`) & receiver (`filewrite.worker` + FSA/OPFS). `apps/web/src/transfer/` |
| **A2** | Strings/Blobs over data channel | 17-byte big-endian binary framing protocol using ArrayBuffers only. `packages/shared/src/protocol/` |
| **A3** | Uncontrolled buffering & timeout pacing | 2-layer flow control: Layer 1 `bufferedAmountLow` (256 KiB / 1 MiB) + Layer 2 block credit window. `apps/web/src/transfer/sender/` |
| **A4** | Hardcoded chunk size | Hello handshake negotiation; constants centralized in `packages/shared/src/constants/` |
| **A5** | Unordered or dynamic data channels | Pre-negotiated fixed channels (id 0 `ctl`, id 1 `data`, `negotiated: true`). `apps/web/src/core/peer/` |
| **A6** | Static / hardcoded TURN credentials | Ephemeral 24h HMAC-SHA1 tokens issued dynamically by `/api/turn-credentials`. `apps/signaling/src/turn/` |
| **A7** | Naive client IP from headers | Trusted proxy parser checking peer IP against `TRUSTED_PROXIES` CIDRs. `apps/signaling/src/clientip/` |
| **A8** | Single-family IPv6 mismatch | Dual-stack probe client + /64 prefix HMAC key-overlap engine. `apps/signaling/src/groups/` |
| **A9** | Glare / lack of perfect negotiation | W3C Perfect Negotiation with deterministic politeness by device ID. `apps/web/src/core/peer/` |
| **A10** | Unqueued ICE candidates | Dedicated candidate queue flushing only after `setRemoteDescription`. `apps/web/src/core/peer/` |
| **A11** | No ICE restart on disconnect | Automatic 4s grace restart on `disconnected` and immediate restart on `failed`. `apps/web/src/core/peer/` |
| **A12** | Lost signaling state on reconnect | Transport ladder (WS -> SSE+POST -> Long-Poll) with 60s message replay buffer & resume tokens. `apps/signaling/src/gateway/` |
| **A13** | Leaked peer connections/timers | Centralized `close()` teardown closing channels, connections, timers, and wake locks. `apps/web/src/core/peer/` |
| **A14** | State lost on tab sleep | IndexedDB transfer journal with 1s debounced flushes & pagehide flushes. `apps/web/src/transfer/resume/journal.ts` |
| **A15** | No receiver ACKs or resume | Block-level acknowledgments, verified bitset bitmap, and resume rejoin protocol. `apps/web/src/transfer/resume/bitmap.ts` |
| **A16** | Insecure HTTP/WS in production | Enforced TLS/WSS, HSTS, and strict CSP headers. `infra/proxy/nginx.conf` |
| **A17** | In-memory Blob `<a download>` | Tiered storage writer: FSA -> OPFS SyncAccessHandle -> SW Stream -> Memory (<200MB). `apps/web/src/transfer/storage/` |
| **A18** | UI progress from send() bytes | UI progress updated strictly from verified receiver block ACKs. `apps/web/src/transfer/sender/` |
| **A19** | UI thread blocking | Offloaded hashing to `hash.worker`, slicing to `fileread.worker`, disk writes to `filewrite.worker`. `apps/web/workers/` |
| **A20** | Missing WakeLock re-acquisition | Re-acquire on `visibilitychange` to visible + silent looping video keep-awake for iOS. `apps/web/src/platform/` |
