# ShareApp Troubleshooting & Operational Runbook

This guide covers common network configurations, failure modes, and recovery strategies.

---

## 1. Network Discovery & "Same Wi-Fi" Issues

### Symptom: Devices on the same Wi-Fi cannot see each other
- **Cause 1: Dual-Stack Family Mismatch** (e.g. Phone connects via IPv6, Laptop via IPv4).
  - *Fix*: The app automatically uses the dual-stack probe client to gather both IPv4 and IPv6 /64 prefix keys. Ensure your DNS records for `v4.example.com` (A only) and `v6.example.com` (AAAA only) are NOT proxied by Cloudflare.
- **Cause 2: AP / Client Isolation (Guest Wi-Fi / Hotel / Enterprise)**
  - *Fix*: Access Points often block direct device-to-device traffic. ShareApp will automatically route through TURN relay or Server Relay without interrupting the user. You can also pair immediately using the 8-character Room code or QR code.
- **Cause 3: VPN or iCloud Private Relay**
  - *Fix*: VPNs change the apparent public IP of the device. Use the 8-character Room code or QR code to pair across different networks.

---

## 2. WebRTC Connection & Firewall Issues

### Symptom: PeerSession stuck in "Connecting"
- **Cause: Strict Corporate Firewalls / UDP Blocked**
  - *Fix*: ShareApp automatically falls back from UDP 3478 to TCP 3478, then TURNS TLS 5349, and finally TURNS TLS 443 (masquerading as standard HTTPS). If all STUN/TURN fails within 12 seconds, the app activates the Encrypted Server Relay fallback automatically.

### Symptom: ICE Connection Disconnected / Failed
- **Cause: Brief Wi-Fi drop, switching from Wi-Fi to cellular, or laptop lid closed**
  - *Fix*: On `disconnected`, ShareApp waits 4 seconds before triggering an ICE restart from the impolite side. On `failed`, it immediately executes an ICE restart. Transmissions resume from the last verified block using the IndexedDB journal.

---

## 3. Storage & Mobile Browser Limitations

### Symptom: Insufficient Quota Error
- **Cause**: Browser disk quota is full or free space is less than file size + 10%.
  - *Fix*: Free space on device. ShareApp calls `navigator.storage.estimate()` and prevents out-of-memory crashes before starting.

### Symptom: Transfer Pauses When Switching Apps on iOS
- **Cause**: iOS Safari suspends JavaScript execution, WebRTC, and WebSockets when backgrounded.
  - *Behavior*: A persistent banner reminds mobile users: *"Keep this screen open. Switching apps can pause the transfer."* Transmissions automatically resume from the last verified block as soon as the user re-opens the app.
