import crypto from 'crypto';
import type http from 'http';

/** D1: derive a network grouping key from the client's apparent public IP. */
export function computeNetworkKey(ip: string): string {
  let addr = (ip || '').trim();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // strip IPv4-mapped prefix
  if (addr.includes(':')) {
    // IPv6 — group by the /64 prefix (first 4 hextets)
    const clean = addr.split('%')[0];
    const hextets = clean.split(':').filter(Boolean);
    return 'v6:' + hextets.slice(0, 4).join(':');
  }
  return 'v4:' + addr;
}

export function extractClientIp(req: http.IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.split(',')[0].trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

export function normalizeRoomCode(raw: string): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').slice(0, 6);
}

/** R4: cryptographically random 6-digit numeric code (server-owned). */
export function generateRoomCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** R4 rate limiter used by join-room. */
export interface RateState { count: number; windowStart: number; lockedUntil: number }
export const JOIN_LIMIT = 5;
export const JOIN_WINDOW_MS = 60_000;
export const JOIN_LOCKOUT_MS = 120_000;

export function checkJoinRate(state: RateState | undefined, now: number): { allowed: boolean; next: RateState } {
  const rl = state ? { ...state } : { count: 0, windowStart: now, lockedUntil: 0 };
  if (rl.lockedUntil > now) return { allowed: false, next: rl };
  if (now - rl.windowStart > JOIN_WINDOW_MS) {
    rl.count = 0;
    rl.windowStart = now;
  }
  rl.count += 1;
  if (rl.count > JOIN_LIMIT) {
    rl.lockedUntil = now + JOIN_LOCKOUT_MS;
    return { allowed: false, next: rl };
  }
  return { allowed: true, next: rl };
}
