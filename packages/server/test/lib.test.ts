import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  isPrivateIp,
  computeNetworkKey,
  areDevicesOnSameNetwork,
  extractClientIp,
  normalizeRoomCode,
  generateRoomCode,
  checkJoinRate,
  JOIN_LIMIT,
} from '../src/lib';
import type http from 'http';

describe('isPrivateIp (LAN, Hotspots, Dual-Band subnets)', () => {
  it('detects loopback addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('localhost')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('detects IPv6 link-local', () => {
    expect(isPrivateIp('fe80::1ff:fe23:4567:890a')).toBe(true);
  });

  it('detects IPv4 link-local (169.254.0.0/16)', () => {
    expect(isPrivateIp('169.254.1.10')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.100.200')).toBe(true);
  });

  it('detects 10.0.0.0/8 private class A', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.200.1.50')).toBe(true);
    expect(isPrivateIp('::ffff:10.1.2.3')).toBe(true);
  });

  it('detects 172.16.0.0/12 (iOS Hotspot 172.20.10.x)', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.20.10.1')).toBe(true); // iOS personal hotspot gateway
    expect(isPrivateIp('172.20.10.5')).toBe(true); // iOS personal hotspot client
    expect(isPrivateIp('172.31.255.254')).toBe(true);
    expect(isPrivateIp('172.32.0.1')).toBe(false); // public
  });

  it('detects 192.168.0.0/16 (Android Hotspot 192.168.43.x, dual-band 2.4/5GHz)', () => {
    expect(isPrivateIp('192.168.1.10')).toBe(true); // 5GHz Wi-Fi device
    expect(isPrivateIp('192.168.2.15')).toBe(true); // 2.4GHz Wi-Fi device
    expect(isPrivateIp('192.168.43.1')).toBe(true); // Android hotspot gateway
    expect(isPrivateIp('192.168.43.142')).toBe(true); // Android hotspot client
  });

  it('returns false for public internet IPs', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('203.0.113.195')).toBe(false);
    expect(isPrivateIp('2600:1700:ccd0:5a40:1:2:3:4')).toBe(false);
  });
});

describe('network grouping (computeNetworkKey)', () => {
  it('groups loopback into local_loopback', () => {
    expect(computeNetworkKey('127.0.0.1')).toBe('local_loopback');
    expect(computeNetworkKey('::1')).toBe('local_loopback');
    expect(computeNetworkKey('localhost')).toBe('local_loopback');
    expect(computeNetworkKey('::ffff:127.0.0.1')).toBe('local_loopback');
  });

  it('groups all private LAN & hotspot IPs into local_lan', () => {
    // Both 5GHz (192.168.1.x) and 2.4GHz (192.168.2.x) devices share local_lan
    expect(computeNetworkKey('192.168.1.50')).toBe('local_lan');
    expect(computeNetworkKey('192.168.2.99')).toBe('local_lan');
    // Android hotspot
    expect(computeNetworkKey('192.168.43.1')).toBe('local_lan');
    expect(computeNetworkKey('192.168.43.15')).toBe('local_lan');
    // iOS hotspot
    expect(computeNetworkKey('172.20.10.2')).toBe('local_lan');
    // Corporate/Home 10.x LAN
    expect(computeNetworkKey('10.0.0.12')).toBe('local_lan');
  });

  it('groups public IPv6 by /64 prefix', () => {
    expect(computeNetworkKey('2001:db8:aaaa:bbbb:1:2:3:4')).toBe('v6:2001:db8:aaaa:bbbb');
    expect(computeNetworkKey('2001:db8:aaaa:bbbb:9:9:9:9')).toBe('v6:2001:db8:aaaa:bbbb');
    expect(computeNetworkKey('2001:db8:cccc:dddd:1:2:3:4')).not.toBe('v6:2001:db8:aaaa:bbbb');
  });

  it('groups public IPv4 by exact address', () => {
    expect(computeNetworkKey('203.0.113.7')).toBe('v4:203.0.113.7');
    expect(computeNetworkKey('::ffff:203.0.113.7')).toBe('v4:203.0.113.7');
    expect(computeNetworkKey('203.0.113.8')).not.toBe('v4:203.0.113.7');
  });
});

describe('cross-network matching (areDevicesOnSameNetwork)', () => {
  const origEnv = process.env.STRICT_NETWORK_MATCHING;
  beforeAll(() => { process.env.STRICT_NETWORK_MATCHING = 'true'; });
  afterAll(() => { process.env.STRICT_NETWORK_MATCHING = origEnv; });

  it('matches devices on same networkKey', () => {
    const devA = { networkKey: 'local_lan', clientIp: '192.168.1.10' };
    const devB = { networkKey: 'local_lan', clientIp: '192.168.43.5' };
    expect(areDevicesOnSameNetwork(devA, devB)).toBe(true);
  });

  it('matches devices with different networkKey when STUN networkHint matches', () => {
    // e.g. Phone connected via IPv6 to Cloudflare tunnel, PC connected via IPv4,
    // but both share the same public reflexive IP detected via STUN
    const devA = { networkKey: 'v6:2600:1700:abcd:1234', clientIp: '2600:1700:abcd:1234:1:2:3:4', networkHint: '198.51.100.42' };
    const devB = { networkKey: 'v4:198.51.100.42', clientIp: '198.51.100.42', networkHint: '198.51.100.42' };
    expect(areDevicesOnSameNetwork(devA, devB)).toBe(true);
  });

  it('matches when one device networkHint equals other device clientIp', () => {
    const devA = { networkKey: 'v6:2600:1700:abcd:1234', clientIp: '2600:1700:abcd:1234::1', networkHint: '198.51.100.42' };
    const devB = { networkKey: 'v4:198.51.100.42', clientIp: '198.51.100.42' };
    expect(areDevicesOnSameNetwork(devA, devB)).toBe(true);
  });

  it('returns false for unrelated devices on different networks', () => {
    const devA = { networkKey: 'v4:203.0.113.1', clientIp: '203.0.113.1', networkHint: '203.0.113.1' };
    const devB = { networkKey: 'v4:203.0.113.2', clientIp: '203.0.113.2', networkHint: '203.0.113.2' };
    expect(areDevicesOnSameNetwork(devA, devB)).toBe(false);
  });
});

describe('extractClientIp header resolution', () => {
  function makeReq(headers: Record<string, string | string[]>, remote = '127.0.0.1'): http.IncomingMessage {
    return {
      headers,
      socket: { remoteAddress: remote },
    } as unknown as http.IncomingMessage;
  }

  it('prefers cf-connecting-ip', () => {
    const req = makeReq({
      'cf-connecting-ip': '203.0.113.195',
      'x-forwarded-for': '10.0.0.1, 10.0.0.2',
    });
    expect(extractClientIp(req)).toBe('203.0.113.195');
  });

  it('falls back to x-forwarded-for first entry', () => {
    const req = makeReq({
      'x-forwarded-for': '203.0.113.50, 10.0.0.1',
    });
    expect(extractClientIp(req)).toBe('203.0.113.50');
  });

  it('falls back to x-real-ip', () => {
    const req = makeReq({
      'x-real-ip': '203.0.113.88',
    });
    expect(extractClientIp(req)).toBe('203.0.113.88');
  });

  it('falls back to socket remoteAddress', () => {
    const req = makeReq({}, '192.168.1.25');
    expect(extractClientIp(req)).toBe('192.168.1.25');
  });
});

describe('room codes (R4)', () => {
  it('normalizes formatted and pasted codes to 6 digits', () => {
    expect(normalizeRoomCode('123-456')).toBe('123456');
    expect(normalizeRoomCode('  12 34 56 ')).toBe('123456');
    expect(normalizeRoomCode('https://x.app/#room=987654')).toBe('987654');
    expect(normalizeRoomCode('abc-789-012-xyz')).toBe('789012');
  });

  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('join rate limiting (R4)', () => {
  it('allows up to the limit then locks out', () => {
    let state;
    const now = 1_000_000;
    for (let i = 0; i < JOIN_LIMIT; i++) {
      const r = checkJoinRate(state, now + i);
      expect(r.allowed).toBe(true);
      state = r.next;
    }
    const blocked = checkJoinRate(state, now + 10);
    expect(blocked.allowed).toBe(false);
    // Still locked shortly after
    expect(checkJoinRate(blocked.next, now + 30_000).allowed).toBe(false);
    // Unlocked after lockout expires
    expect(checkJoinRate(blocked.next, now + 200_000).allowed).toBe(true);
  });
});
