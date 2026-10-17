import {
  LOCAL_GROUP_DISCONNECT_GRACE_MS,
  LOCAL_GROUP_MAX_VISIBLE,
} from '@shareapp/shared';

export interface DeviceSession {
  deviceId: string;
  name: string;
  platform: string;
  model?: string;
  os?: string;
  browser?: string;
  deviceType?: string;
  batteryLevel?: number;
  isCharging?: boolean;
  clientIp?: string;
  networkKeys: Set<string>;
  connectedAt: number;
  lastSeen: number;
  heartbeatComplete: boolean;
  resumeToken: string;
  disconnectTimer?: NodeJS.Timeout;
}

export class LocalGroupIndex {
  // key -> Set of deviceIds
  private keyToDevices = new Map<string, Set<string>>();
  // deviceId -> DeviceSession
  private devices = new Map<string, DeviceSession>();
  // resumeToken -> deviceId
  private tokenToDeviceId = new Map<string, string>();

  public registerDevice(session: DeviceSession): {
    tooManyDevices: boolean;
    evictedDeviceIds: string[];
  } {
    const evictedDeviceIds: string[] = [];

    // 1. Clean up old keys if re-registering existing deviceId
    const existing = this.devices.get(session.deviceId);
    if (existing) {
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      this.tokenToDeviceId.delete(existing.resumeToken);
      for (const k of existing.networkKeys) {
        const s = this.keyToDevices.get(k);
        if (s) {
          s.delete(session.deviceId);
          if (s.size === 0) this.keyToDevices.delete(k);
        }
      }
    }

    // 2. Evict any stale/ghost sessions from the exact same physical device
    // (e.g. same clientIp + name + platform + model that is disconnecting or superseded)
    for (const [otherId, other] of Array.from(this.devices.entries())) {
      if (otherId === session.deviceId) continue;
      const sameHardware =
        other.name === session.name &&
        other.platform === session.platform &&
        (other.model || '') === (session.model || '');
      const sameNetwork =
        (session.clientIp && other.clientIp === session.clientIp) ||
        Array.from(session.networkKeys).some((k) => other.networkKeys.has(k));

      if (sameHardware && sameNetwork && (other.disconnectTimer || Date.now() - other.lastSeen > 8000)) {
        this.removeDevice(otherId);
        evictedDeviceIds.push(otherId);
      }
    }

    this.devices.set(session.deviceId, session);
    this.tokenToDeviceId.set(session.resumeToken, session.deviceId);

    for (const key of session.networkKeys) {
      let set = this.keyToDevices.get(key);
      if (!set) {
        set = new Set();
        this.keyToDevices.set(key, set);
      }
      set.add(session.deviceId);
    }

    const visiblePeers = this.getVisiblePeers(session.deviceId);
    const tooManyDevices = visiblePeers.length > LOCAL_GROUP_MAX_VISIBLE;
    return { tooManyDevices, evictedDeviceIds };
  }

  public getSession(deviceId: string): DeviceSession | undefined {
    return this.devices.get(deviceId);
  }

  public getDeviceCount(): number {
    return this.devices.size;
  }

  public getSessionByToken(resumeToken: string): DeviceSession | undefined {
    const id = this.tokenToDeviceId.get(resumeToken);
    return id ? this.devices.get(id) : undefined;
  }

  public markHeartbeatComplete(deviceId: string) {
    const session = this.devices.get(deviceId);
    if (session) {
      session.heartbeatComplete = true;
      session.lastSeen = Date.now();
    }
  }

  /**
   * Two devices are in the same local group if their key sets overlap in ANY key.
   * Deduplicates ghost entries from the same physical hardware so a device never appears twice.
   */
  public getVisiblePeers(deviceId: string): DeviceSession[] {
    const self = this.devices.get(deviceId);
    if (!self) return [];

    const peerIds = new Set<string>();
    for (const key of self.networkKeys) {
      const matchSet = this.keyToDevices.get(key);
      if (matchSet) {
        for (const peerId of matchSet) {
          if (peerId !== deviceId) {
            peerIds.add(peerId);
          }
        }
      }
    }

    const rawCandidates: DeviceSession[] = [];
    for (const pid of peerIds) {
      const s = this.devices.get(pid);
      if (s && s.heartbeatComplete) {
        rawCandidates.push(s);
      }
    }

    // Sort newest lastSeen first and deduplicate by physical device signature if one is a stale ghost
    rawCandidates.sort((a, b) => b.lastSeen - a.lastSeen);
    const bySignature = new Map<string, DeviceSession>();
    for (const cand of rawCandidates) {
      const sig = `${cand.clientIp || ''}|${cand.name}|${cand.platform}|${cand.model || ''}|${cand.os || ''}`;
      const prev = bySignature.get(sig);
      if (!prev) {
        bySignature.set(sig, cand);
      } else if (!cand.disconnectTimer && prev.disconnectTimer) {
        bySignature.set(sig, cand);
      }
    }

    return Array.from(bySignature.values());
  }

  public scheduleDisconnect(deviceId: string, onRemove: (departedPeers: DeviceSession[]) => void) {
    const session = this.devices.get(deviceId);
    if (!session) return;

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    session.disconnectTimer = setTimeout(() => {
      const peersToNotify = this.getVisiblePeers(deviceId);
      this.removeDevice(deviceId);
      onRemove(peersToNotify);
    }, LOCAL_GROUP_DISCONNECT_GRACE_MS);
  }

  public cancelDisconnect(deviceId: string) {
    const session = this.devices.get(deviceId);
    if (session?.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }
  }

  public removeDevice(deviceId: string) {
    const session = this.devices.get(deviceId);
    if (!session) return;

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    this.tokenToDeviceId.delete(session.resumeToken);
    for (const key of session.networkKeys) {
      const set = this.keyToDevices.get(key);
      if (set) {
        set.delete(deviceId);
        if (set.size === 0) this.keyToDevices.delete(key);
      }
    }
    this.devices.delete(deviceId);
  }
}
