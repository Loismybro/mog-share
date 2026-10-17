import {
  DUAL_STACK_PROBE_TIMEOUT_MS,
  type IceServerConfig,
} from '@shareapp/shared';

const ADJECTIVES = [
  'Brave', 'Swift', 'Quiet', 'Clever', 'Calm', 'Bright', 'Bold', 'Keen',
  'Gentle', 'Proud', 'Noble', 'Wild', 'Quick', 'Witty', 'Loyal', 'Warm',
];

const ANIMALS = [
  'Falcon', 'Otter', 'Panda', 'Lion', 'Eagle', 'Badger', 'Dolphin', 'Tiger',
  'Fox', 'Wolf', 'Owl', 'Koala', 'Hawk', 'Leopard', 'Bear', 'Jaguar',
];

export interface ProbeResult {
  v4Ip: string | null;
  v6Ip: string | null;
  stunV4Ip: string | null;
  stunV6Ip: string | null;
  networkKeys: string[];
  warnings: {
    isVpnDetected: boolean;
    isPrivateRelayDetected: boolean;
    isIpv6ProbeFailed: boolean;
    message?: string;
  };
}

export function generateEphemeralDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function generateFriendlyName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

export function detectDeviceType(): 'phone' | 'tablet' | 'laptop' | 'desktop' | 'web' {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'phone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Android/.test(ua)) {
    return /Mobile/.test(ua) ? 'phone' : 'tablet';
  }
  if (/Macintosh/.test(ua) || /Windows/.test(ua) || /Linux/.test(ua)) {
    return 'desktop';
  }
  return 'web';
}

/**
 * Extracts /64 prefix from IPv6 string
 */
export function extractIpv6Prefix64(ip: string): string {
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
  const expanded = parts.map((h) => h.padStart(4, '0'));
  return expanded.slice(0, 4).join(':');
}

/**
 * Extracts /48 prefix (first 3 hextets) from IPv6 string for 3GPP mobile hotspot prefix delegation matching
 */
export function extractIpv6Prefix48(ip: string): string {
  const p64 = extractIpv6Prefix64(ip);
  return p64.split(':').slice(0, 3).join(':');
}

function isValidIpv4(ip: string | null | undefined): ip is string {
  if (!ip || ip.includes(':')) return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function isValidIpv6(ip: string | null | undefined): ip is string {
  if (!ip || !ip.includes(':')) return false;
  return /^[0-9a-fA-F:%]+$/.test(ip.trim());
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4) return false;
  if (p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  return false;
}

export async function probeNetwork(
  serverUrl: string,
  iceServers: IceServerConfig[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
): Promise<ProbeResult> {
  const baseUrl = serverUrl.replace(/\/+$/, '');
  const probeTimeout = Math.max(DUAL_STACK_PROBE_TIMEOUT_MS, 1800);

  // 1. Probe signaling server + dedicated IPv4-only / IPv6-only external echo endpoints in parallel.
  // Dedicated IPv4-only endpoints (api4.ipify.org / ipv4.icanhazip.com) have only A records,
  // forcing a dual-stack Mobile Hotspot host phone (which defaults to IPv6) to also reveal its
  // exact NAT44/CGNAT IPv4 address shared with tethered hotspot clients!
  const [rawProbe1, rawProbe2, extV4, extV6, iceIps] = await Promise.all([
    fetchIpWithTimeout(`${baseUrl}/api/probe/v4`, DUAL_STACK_PROBE_TIMEOUT_MS),
    fetchIpWithTimeout(`${baseUrl}/api/probe/v6`, DUAL_STACK_PROBE_TIMEOUT_MS),
    raceIpv4Echo(probeTimeout),
    raceIpv6Echo(probeTimeout),
    gatherIceNetworkIps(iceServers, probeTimeout),
  ]);

  const allV4 = new Set<string>();
  const allV6 = new Set<string>();

  for (const candidate of [rawProbe1, rawProbe2, extV4, extV6, ...iceIps.srflxV4, ...iceIps.srflxV6]) {
    if (isValidIpv4(candidate)) {
      allV4.add(candidate.trim());
    } else if (isValidIpv6(candidate)) {
      const cleanV6 = candidate.trim().split('%')[0].toLowerCase();
      if (!cleanV6.startsWith('fe80:')) {
        allV6.add(cleanV6);
      }
    }
  }

  const v4Ip =
    (isValidIpv4(rawProbe1) ? rawProbe1 : null) ||
    extV4 ||
    iceIps.srflxV4[0] ||
    Array.from(allV4)[0] ||
    null;

  const v6Ip =
    (isValidIpv6(rawProbe2) ? rawProbe2 : null) ||
    (isValidIpv6(rawProbe1) ? rawProbe1 : null) ||
    extV6 ||
    iceIps.srflxV6[0] ||
    Array.from(allV6)[0] ||
    null;

  const stunV4Ip = iceIps.srflxV4[0] || extV4 || null;
  const stunV6Ip = iceIps.srflxV6[0] || extV6 || null;

  const keys = new Set<string>();

  // Add full hierarchy for all discovered IPv4 addresses (exact + /24 subnet + /16 CGNAT pool)
  for (const ip of allV4) {
    keys.add(`v4:${ip}`);
    const parts = ip.split('.');
    if (parts.length === 4) {
      keys.add(`v4sub24:${parts[0]}.${parts[1]}.${parts[2]}`);
      if (!isPrivateIpv4(ip)) {
        keys.add(`v4sub16:${parts[0]}.${parts[1]}`);
      } else {
        keys.add('local-lan');
      }
    }
  }

  // Add local host private IPv4 subnets discovered via WebRTC (e.g. 192.168.43.x Android hotspot, 172.20.10.x iOS hotspot)
  for (const hostIp of iceIps.hostV4) {
    keys.add(`v4:${hostIp}`);
    const parts = hostIp.split('.');
    if (parts.length === 4) {
      keys.add(`v4sub24:${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }

  // Add /64 and /48 prefixes for all discovered IPv6 addresses
  for (const ip6 of allV6) {
    keys.add(`v6:${extractIpv6Prefix64(ip6)}`);
    keys.add(`v6sub48:${extractIpv6Prefix48(ip6)}`);
  }

  for (const hostIp6 of iceIps.hostV6) {
    keys.add(`v6:${extractIpv6Prefix64(hostIp6)}`);
    keys.add(`v6sub48:${extractIpv6Prefix48(hostIp6)}`);
  }

  // Always include local-lan key if running on private/local network
  if (
    (!v4Ip && !v6Ip) ||
    v4Ip === '127.0.0.1' ||
    v6Ip === '::1' ||
    (v4Ip && isPrivateIpv4(v4Ip))
  ) {
    keys.add('local-lan');
  }

  if (keys.size === 0) {
    keys.add('v4:127.0.0.1');
    keys.add('local-lan');
  }

  const isIpv6ProbeFailed = !v6Ip && !!v4Ip;
  const isVpnDetected = !!(
    v4Ip &&
    stunV4Ip &&
    v4Ip !== stunV4Ip &&
    !isPrivateIpv4(v4Ip)
  );
  const isPrivateRelayDetected = !!(
    v4Ip &&
    v6Ip &&
    !stunV4Ip &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Macintosh')
  );

  let message: string | undefined;
  if (isVpnDetected) {
    message = 'VPN active: Auto-discovery may be limited. Use QR or Room Code if nearby devices do not appear.';
  } else if (isPrivateRelayDetected) {
    message = 'iCloud Private Relay detected. Devices on the same Wi-Fi may need a Room Code or QR pairing.';
  }

  return {
    v4Ip,
    v6Ip,
    stunV4Ip,
    stunV6Ip,
    networkKeys: Array.from(keys),
    warnings: {
      isVpnDetected,
      isPrivateRelayDetected,
      isIpv6ProbeFailed,
      message,
    },
  };
}

async function raceIpv4Echo(timeoutMs: number): Promise<string | null> {
  // Only run external IPv4 echo in real browser sessions where window is defined
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  const endpoints = [
    'https://api4.ipify.org',
    'https://ipv4.icanhazip.com',
    'https://v4.ident.me',
  ];
  return new Promise((resolve) => {
    let settled = false;
    let pending = endpoints.length;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    for (const url of endpoints) {
      fetchIpWithTimeout(url, timeoutMs)
        .then((ip) => {
          if (!settled && isValidIpv4(ip)) {
            settled = true;
            clearTimeout(timer);
            resolve(ip);
          }
        })
        .catch(() => {})
        .finally(() => {
          pending--;
          if (pending <= 0 && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        });
    }
  });
}

async function raceIpv6Echo(timeoutMs: number): Promise<string | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  const endpoints = [
    'https://api6.ipify.org',
    'https://ipv6.icanhazip.com',
  ];
  return new Promise((resolve) => {
    let settled = false;
    let pending = endpoints.length;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    for (const url of endpoints) {
      fetchIpWithTimeout(url, timeoutMs)
        .then((ip) => {
          if (!settled && isValidIpv6(ip)) {
            settled = true;
            clearTimeout(timer);
            resolve(ip);
          }
        })
        .catch(() => {})
        .finally(() => {
          pending--;
          if (pending <= 0 && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        });
    }
  });
}

async function fetchIpWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (text.startsWith('<') || text.length > 64) return null;
    return text.length > 0 ? text : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function gatherIceNetworkIps(
  iceServers: IceServerConfig[],
  timeoutMs: number
): Promise<{
  srflxV4: string[];
  srflxV6: string[];
  hostV4: string[];
  hostV6: string[];
}> {
  const srflxV4 = new Set<string>();
  const srflxV6 = new Set<string>();
  const hostV4 = new Set<string>();
  const hostV6 = new Set<string>();

  if (typeof RTCPeerConnection === 'undefined') {
    return { srflxV4: [], srflxV6: [], hostV4: [], hostV6: [] };
  }

  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        pc?.close();
      } catch {}
      resolve({
        srflxV4: Array.from(srflxV4),
        srflxV6: Array.from(srflxV6),
        hostV4: Array.from(hostV4),
        hostV6: Array.from(hostV6),
      });
    };

    const timer = setTimeout(finish, timeoutMs);

    try {
      const mergedServers: RTCIceServer[] = [
        ...(iceServers as RTCIceServer[]),
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ];
      pc = new RTCPeerConnection({ iceServers: mergedServers });
      pc.createDataChannel('probe');

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          clearTimeout(timer);
          finish();
          return;
        }

        const candidateStr = ev.candidate.candidate || '';
        const parts = candidateStr.split(' ');
        const ip = (ev.candidate as { address?: string }).address || parts[4];
        const candType = (ev.candidate as { type?: string }).type || parts[7];
        if (!ip || ip.endsWith('.local')) return;

        if (candType === 'srflx' || candidateStr.includes(' typ srflx')) {
          if (isValidIpv6(ip)) {
            const clean = ip.split('%')[0].toLowerCase();
            if (!clean.startsWith('fe80:')) srflxV6.add(clean);
          } else if (isValidIpv4(ip)) {
            srflxV4.add(ip);
          }
        } else if (candType === 'host' || candidateStr.includes(' typ host')) {
          if (isValidIpv4(ip) && isPrivateIpv4(ip) && ip !== '127.0.0.1') {
            hostV4.add(ip);
          } else if (isValidIpv6(ip)) {
            const clean = ip.split('%')[0].toLowerCase();
            if (!clean.startsWith('fe80:') && clean !== '::1') {
              hostV6.add(clean);
            }
          }
        }
      };

      void pc.createOffer().then((offer) => pc?.setLocalDescription(offer));
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

