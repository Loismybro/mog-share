import type http from 'http';
import crypto from 'crypto';

// Default trusted proxy CIDRs (local development, docker bridges, standard private networks)
const DEFAULT_TRUSTED_PROXIES = [
  '127.0.0.1',
  '::1',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
];

/**
 * Checks whether an IP is in a CIDR range or exact match.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const cleanIp = normalizeIp(ip);
  const cleanCidr = cidr.trim();

  if (!cleanCidr.includes('/')) {
    return cleanIp === normalizeIp(cleanCidr);
  }

  const [range, bitsStr] = cleanCidr.split('/');
  const bits = parseInt(bitsStr, 10);

  if (cleanIp.includes('.') && range.includes('.')) {
    // IPv4 CIDR check
    const ipNum = ip4ToNumber(cleanIp);
    const rangeNum = ip4ToNumber(normalizeIp(range));
    if (ipNum === null || rangeNum === null || isNaN(bits)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  // IPv6 simple prefix check for /64 or similar
  if (cleanIp.includes(':') && range.includes(':')) {
    const ipHextets = expandIpv6(cleanIp);
    const rangeHextets = expandIpv6(normalizeIp(range));
    const hextetCount = Math.floor(bits / 16);
    for (let i = 0; i < hextetCount; i++) {
      if (ipHextets[i] !== rangeHextets[i]) return false;
    }
    return true;
  }

  return false;
}

function ip4ToNumber(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function expandIpv6(ip: string): string[] {
  const clean = ip.split('%')[0].toLowerCase();
  let parts = clean.split(':');
  if (parts.length < 8) {
    const emptyIndex = parts.indexOf('');
    if (emptyIndex !== -1) {
      const missing = 8 - (parts.length - 1);
      const zeros = new Array(missing).fill('0000');
      parts.splice(emptyIndex, 1, ...zeros);
    }
  }
  return parts.map((h) => h.padStart(4, '0'));
}

export function normalizeIp(ip: string): string {
  let addr = (ip || '').trim();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return addr.split('%')[0].split(':')[0].includes('.') ? addr.split('%')[0] : addr.split('%')[0];
}

/**
 * Extracts verified client IP according to Section 3.2.
 * Never trusts X-Forwarded-For unless the socket peer is in TRUSTED_PROXIES.
 */
export function extractVerifiedClientIp(
  req: http.IncomingMessage,
  trustedProxiesList = (process.env.TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean)
): { clientIp: string; family: 'ipv4' | 'ipv6'; isProxied: boolean } {
  const peerSocketIp = normalizeIp(req.socket.remoteAddress || '127.0.0.1');
  const trustedCidrs = trustedProxiesList.length > 0 ? trustedProxiesList : DEFAULT_TRUSTED_PROXIES;

  const isPeerTrusted = trustedCidrs.some((cidr) => isIpInCidr(peerSocketIp, cidr));

  let finalIp = peerSocketIp;
  let isProxied = false;

  if (isPeerTrusted) {
    // Cloudflare priority header
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) {
      finalIp = normalizeIp(cf);
      isProxied = true;
    } else {
      // Rightmost entry of X-Forwarded-For
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff.trim()) {
        const parts = xff.split(',').map((s) => normalizeIp(s));
        if (parts.length > 0) {
          finalIp = parts[parts.length - 1];
          isProxied = true;
        }
      }
    }
  }

  const family: 'ipv4' | 'ipv6' = finalIp.includes(':') ? 'ipv6' : 'ipv4';
  return { clientIp: finalIp, family, isProxied };
}

/**
 * Derives network grouping key (Section 3.3).
 * IPv4: full public IPv4 address.
 * IPv6: the /64 prefix only.
 * Hashes with server salt.
 */
export function deriveNetworkKey(ip: string, serverSalt: string): string {
  const clean = normalizeIp(ip);
  let rawGroupKey: string;

  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') {
    rawGroupKey = 'loopback';
  } else if (clean.includes(':')) {
    // IPv6 /64 prefix = first 4 hextets
    const hextets = expandIpv6(clean);
    rawGroupKey = `v6:${hextets.slice(0, 4).join(':')}`;
  } else {
    // Full IPv4
    rawGroupKey = `v4:${clean}`;
  }

  // Hash key with server HMAC secret salt
  return crypto.createHmac('sha256', serverSalt).update(rawGroupKey).digest('hex').slice(0, 24);
}
