# ShareApp Deployment Guide

This guide covers production deployment for ShareApp adhering to Section 3 and Section 9 of the rebuild specification.

---

## 1. DNS Architecture & Hostnames (Section 3.1)

Four hostnames are required for proper dual-stack NAT traversal and discovery:

| Hostname | DNS Record | Proxy / CDN Status | Purpose |
|----------|------------|-------------------|---------|
| `app.example.com` | A + AAAA | May be proxied (Cloudflare, CDN) | Web frontend, signaling WebSockets, SSE, REST API |
| `v4.example.com` | A only | **DNS-Only (NO proxy / CDN)** | IPv4-only probe endpoint (`/ip`) |
| `v6.example.com` | AAAA only | **DNS-Only (NO proxy / CDN)** | IPv6-only probe endpoint (`/ip`) |
| `turn.example.com` | A + AAAA | **DNS-Only (NO proxy / CDN)** | Coturn STUN/TURN/TURNS server |

> **Critical Rule**: `v4.example.com` and `v6.example.com` MUST NOT be proxied through Cloudflare or any CDN. CDNs accept incoming connections on both IPv4 and IPv6 and terminate them, which destroys the dual-stack probe's ability to observe the client's family-specific public IP.

### TLS Certificates
All domains require valid public TLS certificates (Let's Encrypt). Use Certbot with automated renewal hooks.

---

## 2. Reverse Proxy & Client IP Extraction (Section 3.2)

When behind Cloudflare or a reverse proxy:
1. Turn **OFF** Cloudflare "Pseudo IPv4" so client IPv6 addresses are not converted to synthetic IPv4 addresses.
2. In `infra/proxy/nginx.conf`:
   - `set_real_ip_from` lists the trusted Cloudflare and internal load-balancer CIDRs.
   - `real_ip_header CF-Connecting-IP;` or `X-Forwarded-For;` with `real_ip_recursive on;`.
   - WebSockets have `proxy_read_timeout 120s;` (exceeding 3x 20s heartbeat).
   - SSE paths disable buffering with `proxy_buffering off;`.

---

## 3. Coturn TURN Server (Section 3.7 & Section 9)

### Authentication
Coturn uses REST-style time-limited shared secret authentication:
- `username`: `<expiry_unix_timestamp>:<random_identifier>`
- `credential`: `base64(HMAC-SHA1(static-auth-secret, username))`
- Tokens are issued dynamically by the signaling server at session start with a 24-hour TTL.

### Ports & Firewall
- UDP 3478 & TCP 3478 (STUN/TURN)
- TCP 5349 (TURNS standard)
- TCP 443 (TURNS firewall bypass — looks like HTTPS)
- UDP 49152-65535 (Media relay range)

---

## 4. Running with Docker Compose

1. Copy environment template:
   ```bash
   cp infra/coturn/turnserver.env.example infra/coturn/turnserver.env
   ```
2. Edit `turnserver.env` and set a strong 64-character random `COTURN_SECRET`.
3. Launch services:
   ```bash
   cd infra/docker
   docker compose up -d
   ```
4. Check service health:
   ```bash
   docker compose ps
   ```
