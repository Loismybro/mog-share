import {
  LOCAL_GROUP_DISCONNECT_GRACE_MS,
  LOCAL_GROUP_MAX_VISIBLE,
} from '@shareapp/shared';

export interface DeviceSession {
  deviceId: string;
  name: string;
  platform: string;
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

  public registerDevice(session: DeviceSession): { tooManyDevices: boolean } {
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
    return { tooManyDevices };
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
   * Only returns devices whose heartbeat round trip has completed.
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

    const result: DeviceSession[] = [];
    for (const pid of peerIds) {
      const s = this.devices.get(pid);
      if (s && s.heartbeatComplete) {
        result.push(s);
      }
    }
    return result;
  }

  public scheduleDisconnect(deviceId: string, onRemove: () => void) {
    const session = this.devices.get(deviceId);
    if (!session) return;

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
    }

    session.disconnectTimer = setTimeout(() => {
      this.removeDevice(deviceId);
      onRemove();
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
