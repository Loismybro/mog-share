# Exact Port and Firewall Table (Section 9)

### App Host (Web App & Signaling Proxy)
| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 80 | TCP | 0.0.0.0/0, ::/0 | HTTP (Let's Encrypt ACME challenge, 301 redirect to HTTPS) |
| 443 | TCP | 0.0.0.0/0, ::/0 | HTTPS & WSS (PWA static assets, WebSocket signaling, SSE, probe endpoints) |

### TURN Host (Dedicated Coturn Server)
| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 3478 | UDP | 0.0.0.0/0, ::/0 | STUN and TURN UDP default |
| 3478 | TCP | 0.0.0.0/0, ::/0 | STUN and TURN TCP fallback |
| 5349 | TCP | 0.0.0.0/0, ::/0 | TURNS (TURN over TLS) standard port |
| 443 | TCP | 0.0.0.0/0, ::/0 | TURNS (TURN over TLS on port 443: firewall piercer masquerading as HTTPS) |
| 49152-65535 | UDP | 0.0.0.0/0, ::/0 | Dynamic media relay port range allocated for relayed peer traffic |

### Internal / Loopback (Blocked from Public Access)
| Port | Protocol | Notes |
|------|----------|-------|
| 4000 | TCP | Internal signaling service port (bound to Docker bridge/localhost) |
| 5766 | TCP | Coturn CLI (explicitly disabled with `no-cli`) |
