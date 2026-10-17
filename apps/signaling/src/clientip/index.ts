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
 * Checks whether an IP is a private LAN, hotspot, loopback, or link-local address.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const clean = normalizeIp(ip);
  if (
    !clean ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === 'localhost' ||
    clean.startsWith('fe80:') ||
    clean.startsWith('fc00:') ||
    clean.startsWith('fd00:')
  ) {
    return true;
  }
  const parts = clean.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // Carrier-grade NAT / Tailscale
  }
  return false;
}

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
    const ipNum = ip4ToNumber(cleanIp);
    const rangeNum = ip4ToNumber(normalizeIp(range));
    if (ipNum === null || rangeNum === null || isNaN(bits)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

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
  const parts = clean.split(':');
  if (parts.length < 8) {
    const emptyIndex = parts.indexOf('');
    if (emptyIndex !== -1) {
      const missing = 8 - (parts.length - 1);
      const zeros = Array.from({ length: missing }, () => '0000');
      parts.splice(emptyIndex, 1, ...zeros);
    }
  }
  return parts.map((h) => h.padStart(4, '0'));
}

export function normalizeIp(ip: string): string {
  let addr = (ip || '').trim();
  addr = addr.split('%')[0];
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (addr.includes('.') && addr.includes(':')) {
    addr = addr.split(':')[0];
  }
  return addr;
}

/**
 * Extracts verified client IP according to Section 3.2.
 */
export function extractVerifiedClientIp(
  req: http.IncomingMessage,
  trustedProxiesList = (process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
): { clientIp: string; family: 'ipv4' | 'ipv6'; isProxied: boolean } {
  const peerSocketIp = normalizeIp(req.socket?.remoteAddress || '127.0.0.1');
  const trustedCidrs = trustedProxiesList.length > 0 ? trustedProxiesList : DEFAULT_TRUSTED_PROXIES;

  const isPeerTrusted = trustedCidrs.some((cidr) => isIpInCidr(peerSocketIp, cidr));

  let finalIp = peerSocketIp;
  let isProxied = false;

  if (isPeerTrusted) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) {
      finalIp = normalizeIp(cf);
      isProxied = true;
    } else {
      const xff = req.headers['x-forwarded-for'];
      if (typeof xff === 'string' && xff.trim()) {
        const parts = xff
          .split(',')
          .map((s) => normalizeIp(s))
          .filter(Boolean);
        if (parts.length > 0) {
          if (process.env.TRUST_PROXY_HOPS) {
            const hops = parseInt(process.env.TRUST_PROXY_HOPS, 10) || 0;
            let idx = parts.length - 1 - hops;
            while (idx > 0 && trustedCidrs.some((cidr) => isIpInCidr(parts[idx], cidr))) idx--;
            finalIp = parts[Math.max(0, idx)];
          } else {
            // First non-trusted-proxy IP from left (standard X-Forwarded-For client IP)
            const firstPublic = parts.find(
              (ip) => !trustedCidrs.some((cidr) => isIpInCidr(ip, cidr))
            );
            finalIp = firstPublic || parts[0];
          }
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
    const hextets = expandIpv6(clean);
    rawGroupKey = `v6:${hextets.slice(0, 4).join(':')}`;
  } else {
    rawGroupKey = `v4:${clean}`;
  }

  return crypto.createHmac('sha256', serverSalt).update(rawGroupKey).digest('hex').slice(0, 24);
}

function hmacKey(raw: string, serverSalt: string): string {
  return crypto.createHmac('sha256', serverSalt).update(raw).digest('hex').slice(0, 24);
}

function addIpHierarchyKeys(ip: string, serverSalt: string, keys: Set<string>): void {
  const clean = normalizeIp(ip);
  if (!clean) return;

  keys.add(deriveNetworkKey(clean, serverSalt));

  if (isPrivateOrLocalIp(clean)) {
    keys.add(hmacKey('local-lan-group', serverSalt));
  }

  if (clean.includes(':')) {
    const hextets = expandIpv6(clean);
    // /64 prefix
    keys.add(hmacKey(`v6:${hextets.slice(0, 4).join(':')}`, serverSalt));
    // /48 prefix: 3GPP mobile hotspots assign adjacent /64 prefixes from the same /48
    // to the host phone (default APN) and tethered hotspot clients (dun APN)
    if (hextets[0] !== 'fe80' && hextets[0] !== '0000') {
      keys.add(hmacKey(`v6net48:${hextets.slice(0, 3).join(':')}`, serverSalt));
    }
  } else {
    const parts = clean.split('.');
    if (parts.length === 4 && parts.every((p) => !isNaN(Number(p)))) {
      // /24 subnet key (matches local LAN subnets and carrier CGNAT /24 pools)
      keys.add(hmacKey(`v4subnet:${parts[0]}.${parts[1]}.${parts[2]}`, serverSalt));
      // /16 carrier CGNAT key (matches mobile hotspot host + tethered client when carrier PGW uses a /16 pool)
      if (!isPrivateOrLocalIp(clean)) {
        keys.add(hmacKey(`v4net16:${parts[0]}.${parts[1]}`, serverSalt));
      }
    }
  }
}

/**
 * Derives a comprehensive set of matching network group keys for a device connection.
 * Ensures that devices on the same Wi-Fi LAN, mobile hotspot (including dual-stack
 * CLAT464, CGNAT pools, and 3GPP /48 prefix delegation), /24 subnet, loopback,
 * or shared public IPv4/IPv6 network automatically discover one another.
 */
export function deriveNetworkKeySet(
  clientIp: string,
  serverSalt: string,
  clientReportedKeys: string[] = []
): Set<string> {
  const keys = new Set<string>();
  const clean = normalizeIp(clientIp);

  // 1. Add full hierarchy of keys for the observed socket/proxy IP
  addIpHierarchyKeys(clean, serverSalt, keys);

  // 2. Process client-reported probe/STUN/ICE keys
  for (const rawKey of clientReportedKeys) {
    if (!rawKey || typeof rawKey !== 'string') continue;
    const trimmed = rawKey.trim();
    if (!trimmed) continue;

    // Keep raw key if already hashed
    keys.add(trimmed);

    if (trimmed.startsWith('v4:')) {
      const ipPart = trimmed.slice(3);
      addIpHierarchyKeys(ipPart, serverSalt, keys);
    } else if (trimmed.startsWith('v6:')) {
      const v6Part = trimmed.slice(3);
      const fullV6 = v6Part.includes('::') || v6Part.split(':').length >= 8 ? v6Part : `${v6Part}::1`;
      addIpHierarchyKeys(fullV6, serverSalt, keys);
    } else if (trimmed.startsWith('v4sub24:')) {
      const sub24 = trimmed.slice('v4sub24:'.length);
      keys.add(hmacKey(`v4subnet:${sub24}`, serverSalt));
    } else if (trimmed.startsWith('v4sub16:')) {
      const sub16 = trimmed.slice('v4sub16:'.length);
      keys.add(hmacKey(`v4net16:${sub16}`, serverSalt));
    } else if (trimmed.startsWith('v6sub48:')) {
      const sub48 = trimmed.slice('v6sub48:'.length);
      keys.add(hmacKey(`v6net48:${sub48}`, serverSalt));
    } else if (trimmed === 'local-lan') {
      keys.add(hmacKey('local-lan-group', serverSalt));
    }
  }

  return keys;
}

