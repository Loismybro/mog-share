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
  // 128-bit random hex string (Section 3.3)
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
  let parts = clean.split(':');
  if (parts.length < 8) {
    const emptyIndex = parts.indexOf('');
    if (emptyIndex !== -1) {
      const missing = 8 - (parts.length - 1);
      const zeros = new Array(missing).fill('0000');
      parts.splice(emptyIndex, 1, ...zeros);
    }
  }
  const expanded = parts.map((h) => h.padStart(4, '0'));
  return expanded.slice(0, 4).join(':');
}

export async function probeNetwork(
  serverUrl: string,
  iceServers: IceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }]
): Promise<ProbeResult> {
  const baseUrl = serverUrl.replace(/\/+$/, '');

  // 1. In parallel, fetch v4 and v6 /ip probe endpoints with 2.5s timeouts
  const [v4Ip, v6Ip] = await Promise.all([
    fetchIpWithTimeout(`${baseUrl}/api/probe/v4`, DUAL_STACK_PROBE_TIMEOUT_MS),
    fetchIpWithTimeout(`${baseUrl}/api/probe/v6`, DUAL_STACK_PROBE_TIMEOUT_MS),
  ]);

  // 2. Gather srflx candidates from throwaway RTCPeerConnection (second opinion)
  const { stunV4Ip, stunV6Ip } = await gatherStunSrflxIps(iceServers);

  // 3. Build set of network keys
  const keys = new Set<string>();

  // Full IPv4
  const finalV4 = v4Ip || stunV4Ip;
  if (finalV4) {
    keys.add(`v4:${finalV4}`);
  }

  // IPv6 /64 prefix
  const finalV6 = v6Ip || stunV6Ip;
  if (finalV6) {
    keys.add(`v6:${extractIpv6Prefix64(finalV6)}`);
  }

  // Fallback: loopback if no public IP
  if (keys.size === 0) {
    keys.add('v4:127.0.0.1');
  }

  // Detect and warn signals (Section 3.3)
  const isIpv6ProbeFailed = !v6Ip && !!v4Ip;
  const isVpnDetected = !!(v4Ip && stunV4Ip && v4Ip !== stunV4Ip);
  const isPrivateRelayDetected = !!(
    v4Ip &&
    v6Ip &&
    !stunV4Ip &&
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

async function fetchIpWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function gatherStunSrflxIps(
  iceServers: IceServerConfig[]
): Promise<{ stunV4Ip: string | null; stunV6Ip: string | null }> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { stunV4Ip: null, stunV6Ip: null };
  }

  return new Promise((resolve) => {
    let pc: RTCPeerConnection | null = null;
    let stunV4Ip: string | null = null;
    let stunV6Ip: string | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { pc?.close(); } catch {}
        resolve({ stunV4Ip, stunV6Ip });
      }
    }, DUAL_STACK_PROBE_TIMEOUT_MS);

    try {
      pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
      pc.createDataChannel('probe');

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            try { pc?.close(); } catch {}
            resolve({ stunV4Ip, stunV6Ip });
          }
          return;
        }

        const candidateStr = ev.candidate.candidate;
        if (candidateStr.includes('srflx')) {
          const parts = candidateStr.split(' ');
          const ip = parts[4];
          if (ip) {
            if (ip.includes(':')) {
              stunV6Ip = ip;
            } else if (ip.includes('.')) {
              stunV4Ip = ip;
            }
          }
        }
      };

      void pc.createOffer().then((offer) => pc?.setLocalDescription(offer));
    } catch {
      clearTimeout(timer);
      resolve({ stunV4Ip: null, stunV6Ip: null });
    }
  });
}
