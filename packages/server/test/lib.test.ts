import { describe, it, expect } from 'vitest';
import {
  computeNetworkKey,
  normalizeRoomCode,
  generateRoomCode,
  checkJoinRate,
  JOIN_LIMIT,
} from '../src/lib';

describe('network grouping (D1)', () => {
  it('strips IPv4-mapped prefix', () => {
    expect(computeNetworkKey('::ffff:203.0.113.7')).toBe('v4:203.0.113.7');
  });
  it('groups IPv6 by /64 prefix', () => {
    expect(computeNetworkKey('2001:db8:aaaa:bbbb:1:2:3:4')).toBe('v6:2001:db8:aaaa:bbbb');
    expect(computeNetworkKey('2001:db8:aaaa:bbbb:9:9:9:9')).toBe('v6:2001:db8:aaaa:bbbb');
  });
  it('same IPv4 means same group, different means different', () => {
    expect(computeNetworkKey('1.2.3.4')).toBe(computeNetworkKey('::ffff:1.2.3.4'));
    expect(computeNetworkKey('1.2.3.4')).not.toBe(computeNetworkKey('1.2.3.5'));
  });
});

describe('room codes (R4)', () => {
  it('normalizes formatted and pasted codes to 6 digits', () => {
    expect(normalizeRoomCode('123-456')).toBe('123456');
    expect(normalizeRoomCode('  12 34 56 ')).toBe('123456');
    expect(normalizeRoomCode('https://x.app/#room=987654')).toBe('987654');
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
