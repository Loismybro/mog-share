import {
  ICE_CONNECTING_MAX_MS,
  ICE_BACKGROUND_UPGRADE_INTERVAL_MS,
} from '@shareapp/shared';
import type { PeerSession, PathType, PeerPathStats } from '../peer/index.js';

export type OverallConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface PathOrchestratorListener {
  onStatusChange: (status: OverallConnectionStatus, liveDetail?: string) => void;
  onPathBadgeChange: (badge: string, pathType: PathType) => void;
  onStats: (stats: PeerPathStats) => void;
}

export class ConnectionLadderOrchestrator {
  private status: OverallConnectionStatus = 'idle';
  private currentPathType: PathType = 'direct_lan';
  private currentBadge = 'Direct (same network)';

  private connectingTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private upgradeIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private isServerRelayActive = false;

  private peerSession: PeerSession | null = null;
  private listener: PathOrchestratorListener;

  constructor(listener: PathOrchestratorListener) {
    this.listener = listener;
  }

  public attachPeerSession(session: PeerSession) {
    this.peerSession = session;
    this.status = 'connecting';
    this.listener.onStatusChange('connecting', 'Racing candidate pairs (Host, STUN, TURN)...');

    // 12 s timeout (Section 3.8): if not connected, start server relay fallback in parallel
    this.connectingTimeoutTimer = setTimeout(() => {
      if (this.status === 'connecting') {
        this.startServerRelayFallback();
      }
    }, ICE_CONNECTING_MAX_MS);
  }

  public handlePeerConnectionState(state: RTCPeerConnectionState) {
    if (state === 'connected') {
      if (this.connectingTimeoutTimer) {
        clearTimeout(this.connectingTimeoutTimer);
        this.connectingTimeoutTimer = null;
      }
      this.status = 'connected';
      this.listener.onStatusChange('connected', 'Connected via WebRTC');
      this.startBackgroundUpgradeChecker();
    } else if (state === 'disconnected') {
      this.status = 'reconnecting';
      this.listener.onStatusChange('reconnecting', 'Connection dropped, attempting ICE restart...');
    } else if (state === 'failed') {
      if (!this.isServerRelayActive) {
        this.startServerRelayFallback();
      } else {
        this.status = 'failed';
        this.listener.onStatusChange('failed', 'All connectivity paths failed');
      }
    }
  }

  public handlePathStats(stats: PeerPathStats) {
    this.currentPathType = stats.pathType;
    this.currentBadge = stats.badgeLabel;
    this.listener.onPathBadgeChange(this.currentBadge, this.currentPathType);
    this.listener.onStats(stats);
  }

  public startServerRelayFallback() {
    this.isServerRelayActive = true;
    this.currentPathType = 'server_relay';
    this.currentBadge = 'Server relay (encrypted)';
    this.status = 'connected';
    this.listener.onStatusChange('connected', 'Connected via Encrypted Server Relay');
    this.listener.onPathBadgeChange(this.currentBadge, this.currentPathType);
    this.startBackgroundUpgradeChecker();
  }

  /**
   * Section 3.8: Upgrade logic
   * If active path is relayed or server-relay, retry ICE restart every 60 s
   */
  private startBackgroundUpgradeChecker() {
    if (this.upgradeIntervalTimer) return;

    this.upgradeIntervalTimer = setInterval(() => {
      if (this.currentPathType === 'turn_relay' || this.currentPathType === 'server_relay') {
        if (this.peerSession) {
          this.peerSession.triggerIceRestart();
        }
      }
    }, ICE_BACKGROUND_UPGRADE_INTERVAL_MS);
  }

  public destroy() {
    if (this.connectingTimeoutTimer) {
      clearTimeout(this.connectingTimeoutTimer);
      this.connectingTimeoutTimer = null;
    }
    if (this.upgradeIntervalTimer) {
      clearInterval(this.upgradeIntervalTimer);
      this.upgradeIntervalTimer = null;
    }
    this.peerSession = null;
    this.status = 'idle';
  }
}
