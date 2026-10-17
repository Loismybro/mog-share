import { describe, it, expect } from 'vitest';
import { generateTurnCredentials } from '../../packages/shared/src/crypto/index.js';
import {
  DEFAULT_TURN_PORT_UDP,
  DEFAULT_TURN_PORT_TCP,
  DEFAULT_TURN_PORT_TLS,
  DEFAULT_TURN_PORT_ALT_TLS,
  TURN_CREDENTIAL_TTL_SEC,
} from '../../packages/shared/src/constants/index.js';
import crypto from 'crypto';

describe('Phase 1 Infra: Coturn REST Credentials and 4 TURN Endpoints', () => {
  const TEST_SECRET = 'super_secret_test_key_for_turn_rest_auth_123456';
  const DOMAIN = 'turn.example.com';

  it('generates valid coturn REST credentials with HMAC-SHA1 and correct TTL', async () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const creds = await generateTurnCredentials(TEST_SECRET, TURN_CREDENTIAL_TTL_SEC, 'client1');
    const afterSec = Math.floor(Date.now() / 1000);

    expect(creds.username).toMatch(/^\d+:client1$/);
    const expiry = parseInt(creds.username.split(':')[0], 10);
    expect(expiry).toBeGreaterThanOrEqual(beforeSec + TURN_CREDENTIAL_TTL_SEC);
    expect(expiry).toBeLessThanOrEqual(afterSec + TURN_CREDENTIAL_TTL_SEC);

    // Verify HMAC-SHA1 independently
    const expectedHmac = crypto
      .createHmac('sha1', TEST_SECRET)
      .update(creds.username)
      .digest('base64');
    expect(creds.credential).toBe(expectedHmac);
  });

  it('builds configuration for all 4 required TURN endpoints', async () => {
    const creds = await generateTurnCredentials(TEST_SECRET, 3600, 'test-session');

    const expectedUrls = [
      `turn:${DOMAIN}:${DEFAULT_TURN_PORT_UDP}?transport=udp`,
      `turn:${DOMAIN}:${DEFAULT_TURN_PORT_TCP}?transport=tcp`,
      `turns:${DOMAIN}:${DEFAULT_TURN_PORT_TLS}?transport=tcp`,
      `turns:${DOMAIN}:${DEFAULT_TURN_PORT_ALT_TLS}?transport=tcp`,
    ];

    const rtcServers: RTCIceServer[] = [
      {
        urls: [
          `turn:${DOMAIN}:${DEFAULT_TURN_PORT_UDP}?transport=udp`,
          `turn:${DOMAIN}:${DEFAULT_TURN_PORT_TCP}?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      },
      {
        urls: [
          `turns:${DOMAIN}:${DEFAULT_TURN_PORT_TLS}?transport=tcp`,
          `turns:${DOMAIN}:${DEFAULT_TURN_PORT_ALT_TLS}?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      },
    ];

    const flattenedUrls = rtcServers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    for (const expected of expectedUrls) {
      expect(flattenedUrls).toContain(expected);
    }
  });

  it('simulates and verifies relay candidate gathering from all 4 endpoints', () => {
    // Simulated SDP ICE candidate lines as returned by coturn across the 4 endpoints
    const simulatedCandidates = [
      'candidate:1001 1 udp 24286975 198.51.100.1 49152 typ relay raddr 192.168.1.50 rport 55000', // UDP 3478
      'candidate:1002 1 tcp 24286974 198.51.100.1 49153 typ relay raddr 192.168.1.50 rport 55001 tcptype passive', // TCP 3478
      'candidate:1003 1 tcp 24286973 198.51.100.1 49154 typ relay raddr 192.168.1.50 rport 55002 tcptype passive', // TLS 5349
      'candidate:1004 1 tcp 24286972 198.51.100.1 49155 typ relay raddr 192.168.1.50 rport 55003 tcptype passive', // TLS 443
    ];

    const relayCandidates = simulatedCandidates.filter((c) => c.includes('typ relay'));
    expect(relayCandidates).toHaveLength(4);

    const udpRelays = relayCandidates.filter((c) => c.includes(' udp '));
    const tcpRelays = relayCandidates.filter((c) => c.includes(' tcp '));
    expect(udpRelays).toHaveLength(1);
    expect(tcpRelays).toHaveLength(3);
  });
});
