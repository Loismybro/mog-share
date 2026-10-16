import type { Platform } from '../types/index.js';
import { generateFriendlyName } from '../core/discovery/index.js';

export interface DetectedDeviceProfile {
  platform: Platform;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  model: string;
  os: string;
  browser: string;
  suggestedName: string;
  connectionLabel: string;
  batteryLevel?: number;
  isCharging?: boolean;
}

export function detectDeviceProfileSync(): DetectedDeviceProfile {
  const suggestedName = generateFriendlyName();

  if (typeof navigator === 'undefined') {
    return {
      platform: 'linux',
      deviceType: 'desktop',
      model: 'Server / Node Host',
      os: 'Linux',
      browser: 'Node.js',
      suggestedName,
      connectionLabel: 'Local / LAN',
    };
  }

  const ua = navigator.userAgent || '';
  let platform: Platform = 'web';
  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  let model = 'Personal Computer';
  let os = 'Unknown OS';
  let browser = 'Modern Browser';

  // Detect OS & Platform
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    platform = 'ios';
    if (/iPad/.test(ua) || navigator.maxTouchPoints > 1) {
      deviceType = 'tablet';
      model = 'Apple iPad';
      os = 'iPadOS';
    } else {
      deviceType = 'mobile';
      model = 'Apple iPhone';
      os = 'iOS';
    }
  } else if (/Android/.test(ua)) {
    platform = 'android';
    deviceType = /Mobile/.test(ua) ? 'mobile' : 'tablet';
    os = 'Android';
    const match = ua.match(/Android[^;]+; ([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(';').map((s) => s.trim());
      model = parts[parts.length - 1] || 'Android Device';
    } else {
      model = 'Android Device';
    }
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    platform = 'macos';
    deviceType = 'desktop';
    os = 'macOS';
    model = 'Apple Mac';
  } else if (/Windows/.test(ua)) {
    platform = 'windows';
    deviceType = 'desktop';
    os = 'Windows';
    model = 'Windows PC';
  } else if (/Linux/.test(ua)) {
    platform = 'linux';
    deviceType = 'desktop';
    os = 'Linux';
    model = 'Linux Machine';
  }

  // Detect Browser
  if (/Edg\//.test(ua)) {
    browser = 'Microsoft Edge';
  } else if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) {
    browser = 'Google Chrome';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = 'Apple Safari';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Mozilla Firefox';
  } else if (/Opera|OPR\//.test(ua)) {
    browser = 'Opera';
  }

  // Connection Label
  let connectionLabel = 'Local / LAN';
  const conn = (navigator as any).connection;
  if (conn) {
    if (conn.effectiveType) {
      connectionLabel = `${conn.effectiveType.toUpperCase()} Network`;
    } else if (conn.type) {
      connectionLabel = `${String(conn.type).toUpperCase()} Network`;
    }
  }

  return {
    platform,
    deviceType,
    model,
    os,
    browser,
    suggestedName,
    connectionLabel,
  };
}

export async function enrichDeviceProfile(
  profile: DetectedDeviceProfile
): Promise<DetectedDeviceProfile> {
  const enriched = { ...profile };

  if (typeof navigator !== 'undefined') {
    // 1. Client Hints API
    const uaData = (navigator as any).userAgentData;
    if (uaData?.getHighEntropyValues) {
      try {
        const highEntropy = await uaData.getHighEntropyValues([
          'model',
          'platform',
          'platformVersion',
          'architecture',
        ]);
        if (highEntropy.model) {
          enriched.model = highEntropy.model;
        }
        if (highEntropy.platform) {
          enriched.os = highEntropy.platform;
        }
      } catch {
        /* ignore */
      }
    }

    // 2. Battery Status API
    if (typeof (navigator as any).getBattery === 'function') {
      try {
        const battery = await (navigator as any).getBattery();
        if (battery) {
          enriched.batteryLevel = Math.round((battery.level || 1) * 100);
          enriched.isCharging = Boolean(battery.charging);
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Network Information API
    const conn = (navigator as any).connection;
    if (conn) {
      if (conn.effectiveType) {
        enriched.connectionLabel = `${conn.effectiveType.toUpperCase()} Network`;
      } else if (conn.type) {
        enriched.connectionLabel = `${String(conn.type).toUpperCase()} Network`;
      }
    }
  }

  return enriched;
}
