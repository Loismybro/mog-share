# Fix notes (what was broken, what changed)

## Root causes found
1. **Multi-file / concurrent transfers crashed.** Every receiver ingested every data frame (no transfer-id filter) -> "offset is out of bounds" / hash mismatch. Fixed in `transfer/receiver`.
2. **Dead ICE servers.** The server returned `turn.example.com` as STUN/TURN and the client *replaced* its working Google STUN with it -> no cross-network (room) connections, slow ICE. Now: public STUN is always kept, TURN only if `COTURN_REALM` is set.
3. **Fallback transports (SSE / long-poll) never worked.** `POST /api/message` ignored `join`, `ping`, `create-room`, `join-room`; long-poll returned the wrong JSON shape. Now they share the WebSocket handler.
4. **Wrong client IP behind proxies** (took the rightmost X-Forwarded-For entry, which is often your own proxy) -> devices on the same Wi-Fi landed in different groups. Now rightmost-*untrusted*; `TRUST_PROXY_HOPS` env supported.
5. **`crypto.subtle` missing on plain http** (testing via http://192.168.x.x) -> every block hash threw. Added a pure-JS SHA-256 fallback (`utils/sha256.ts`).
6. **Flow control:** `bufferedAmountLowThreshold` was never set; waits could hang forever if a channel closed; `sendData` silently dropped frames. All fixed. Duplicate initial credit grant removed.
7. **Duplicate control messages** (data channel + signaling) caused double prompts; now de-duplicated.
8. **Deploy config pointed at deleted folders** (`packages/client`, `packages/server`) and used `workspace:*` which npm can't install. Dockerfile, render.yaml, docker-compose, package.json fixed; pnpm lock files removed (npm is the package manager now).
9. Missing `icon-512.png` (PWA install) added.

## Deploy
- One Node service serves both the web app and the signaling server: `npm install && npm run build && npm start`.
- Do **not** host only the frontend on Vercel (it can't run WebSockets). If you do, set `VITE_SERVER_URL` at build time.
- Use HTTPS in production (service workers, wake lock, crypto need a secure context).
- Behind Render/Fly/Nginx set `TRUST_PROXY_HOPS=1` if devices don't see each other.
- For different networks / mobile data / strict Wi-Fi you need TURN: run coturn (see docker-compose.yml) and set `COTURN_REALM` + `COTURN_SECRET` on the app.

## Known limits (not fixed)
- Server-relay fallback is not usable yet (no key exchange between peers). Without TURN, a transfer between two networks that block peer-to-peer shows a clear error instead of hanging.
- Not run in a real browser here (no network in my sandbox): server/engine logic was tested with Node, UI was not visually checked.
