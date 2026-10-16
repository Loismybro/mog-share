import {
  ICE_CANDIDATE_POOL_SIZE,
  ICE_DISCONNECTED_GRACE_MS,
  ICE_PROBE_PONG_TIMEOUT_MS,
  STATS_POLL_INTERVAL_MS,
} from '@shareapp/shared';

export type PathType = 'direct_lan' | 'direct_wan' | 'turn_relay' | 'server_relay';

export interface PeerPathStats {
  pathType: PathType;
  badgeLabel: string;
  protocol: 'udp' | 'tcp' | 'tls' | 'unknown';
  rttMs: number;
  availableBitrateBps?: number;
}

export type PeerSignal =
  | { type: 'sdp'; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

export interface PeerSessionOptions {
  localDeviceId: string;
  remoteDeviceId: string;
  iceServers: RTCIceServer[];
  forceRelay?: boolean; // For diagnostics and testing
  onSignal: (signal: PeerSignal) => void;
  onCtlMessage?: (data: unknown) => void;
  onDataFrame?: (frame: Uint8Array) => void;
  onPathStats?: (stats: PeerPathStats) => void;
  onConnectionChange?: (state: RTCPeerConnectionState) => void;
}

/**
 * PeerSession implements the W3C Perfect Negotiation Pattern with:
 * - Deterministic politeness (lexicographical device ID comparison)
 * - Fixed negotiated data channels (id 0 ctl, id 1 data)
 * - ICE candidate queuing
 * - Automatic ICE restarts and stats polling
 * - Clean terminal teardown
 */
export class PeerSession {
  public readonly localDeviceId: string;
  public readonly remoteDeviceId: string;
  public readonly isPolite: boolean;

  private pc: RTCPeerConnection;
  private ctlChannel: RTCDataChannel;
  private dataChannel: RTCDataChannel;

  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private candidateQueue: RTCIceCandidateInit[] = [];

  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private ctlQueue: string[] = [];
  private restartCount = 0;
  private closed = false;

  private options: PeerSessionOptions;

  constructor(options: PeerSessionOptions) {
    this.options = options;
    this.localDeviceId = options.localDeviceId;
    this.remoteDeviceId = options.remoteDeviceId;
    // Perfect Negotiation rule: smaller device ID is polite
    this.isPolite = this.localDeviceId < this.remoteDeviceId;

    const config: RTCConfiguration = {
      iceServers: options.iceServers,
      iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: options.forceRelay ? 'relay' : 'all',
    };

    this.pc = new RTCPeerConnection(config);

    // Section 3.6: Pre-negotiated fixed channels
    // id 0 "ctl": ordered, reliable control messages
    this.ctlChannel = this.pc.createDataChannel('ctl', {
      id: 0,
      negotiated: true,
      ordered: true,
    });
    this.ctlChannel.binaryType = 'arraybuffer';

    // id 1 "data": ordered, reliable binary file blocks
    this.dataChannel = this.pc.createDataChannel('data', {
      id: 1,
      negotiated: true,
      ordered: true,
    });
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024;

    this.setupDataChannelHandlers();
    this.setupPeerConnectionHandlers();
    this.startStatsPoller();
    if (this.ctlChannel.readyState === 'open') {
      this.flushCtlQueue();
    }
  }

  public get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  public get iceConnectionState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  public get ctl(): RTCDataChannel {
    return this.ctlChannel;
  }

  public get data(): RTCDataChannel {
    return this.dataChannel;
  }

  public get rtcPeerConnection(): RTCPeerConnection {
    return this.pc;
  }

  private flushCtlQueue() {
    while (this.ctlQueue.length > 0 && this.ctlChannel.readyState === 'open') {
      const msg = this.ctlQueue.shift()!;
      try {
        this.ctlChannel.send(msg);
      } catch (err) {
        console.warn('[PeerSession] Failed to send queued ctl message:', err);
      }
    }
  }

  private setupDataChannelHandlers() {
    this.ctlChannel.onopen = () => {
      this.flushCtlQueue();
    };

    this.ctlChannel.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.type === 'probe-ping') {
            this.sendCtl({ type: 'probe-pong' });
            return;
          }
          if (parsed.type === 'probe-pong') {
            if (this.probeTimeoutTimer) {
              clearTimeout(this.probeTimeoutTimer);
              this.probeTimeoutTimer = null;
            }
            return;
          }
        } catch { /* ignore */ }
      }
      this.options.onCtlMessage?.(ev.data);
    };

    this.dataChannel.onmessage = (ev) => {
      const bytes = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(0);
      this.options.onDataFrame?.(bytes);
    };
  }

  private serializeSdp(desc: RTCSessionDescriptionInit | RTCSessionDescription | null): RTCSessionDescriptionInit | null {
    if (!desc) return null;
    if (typeof (desc as any).toJSON === 'function') {
      return (desc as any).toJSON();
    }
    return { type: desc.type, sdp: desc.sdp };
  }

  private setupPeerConnectionHandlers() {
    // Perfect negotiation: offer creation solely in onnegotiationneeded
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        const serialized = this.serializeSdp(this.pc.localDescription);
        if (serialized) {
          this.options.onSignal({
            type: 'sdp',
            sdp: serialized,
          });
        }
      } catch (err) {
        console.error('[PeerSession] onnegotiationneeded error:', err);
      } finally {
        this.makingOffer = false;
      }
    };

    // Trickle ICE
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const candInit = typeof (ev.candidate as any).toJSON === 'function'
          ? (ev.candidate as any).toJSON()
          : { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex };
        this.options.onSignal({
          type: 'candidate',
          candidate: candInit,
        });
      }
    };

    // Lifecycle handling (Section 3.6)
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.options.onConnectionChange?.(state);

      if (state === 'connected') {
        this.restartCount = 0;
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = null;
        }
      } else if (state === 'disconnected') {
        // Wait 4 s, then trigger an ICE restart from impolite side
        if (!this.disconnectTimer) {
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (this.pc.connectionState === 'disconnected' && !this.isPolite) {
              this.triggerIceRestart();
            }
          }, ICE_DISCONNECTED_GRACE_MS);
        }
      } else if (state === 'failed') {
        // Immediate ICE restart
        this.restartCount++;
        this.triggerIceRestart();
      }
    };
  }

  /**
   * Processes remote incoming signaling messages (SDP or ICE candidate).
   * Implements Perfect Negotiation collision resolution and candidate queuing.
   */
  public async handleSignal(signal: PeerSignal): Promise<void> {
    if (this.closed) return;

    if (signal.type === 'sdp') {
      const description = signal.sdp;
      const isOffer = description.type === 'offer';
      const offerCollision = isOffer && (this.makingOffer || this.pc.signalingState !== 'stable');

      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) {
        return; // Impolite peer ignores colliding offer
      }

      this.isSettingRemoteAnswerPending = description.type === 'answer';
      try {
        if (offerCollision) {
          // Polite peer rolls back
          await Promise.all([
            this.pc.setLocalDescription({ type: 'rollback' }),
            this.pc.setRemoteDescription(description),
          ]);
        } else {
          await this.pc.setRemoteDescription(description);
        }
      } finally {
        this.isSettingRemoteAnswerPending = false;
      }

      // Flush candidates buffered while waiting for setRemoteDescription (Section 3.6)
      await this.flushCandidateQueue();

      if (isOffer) {
        await this.pc.setLocalDescription();
        const serialized = this.serializeSdp(this.pc.localDescription);
        if (serialized) {
          this.options.onSignal({
            type: 'sdp',
            sdp: serialized,
          });
        }
      }
    } else if (signal.type === 'candidate') {
      const candidateInit = signal.candidate;
      if (!this.pc.remoteDescription || this.isSettingRemoteAnswerPending) {
        // Queue candidates until setRemoteDescription completes
        this.candidateQueue.push(candidateInit);
      } else {
        try {
          await this.pc.addIceCandidate(candidateInit);
        } catch (err) {
          if (!this.ignoreOffer) {
            console.warn('[PeerSession] Failed to add ICE candidate:', err);
          }
        }
      }
    }
  }

  private async flushCandidateQueue() {
    const queue = [...this.candidateQueue];
    this.candidateQueue = [];
    for (const cand of queue) {
      try {
        await this.pc.addIceCandidate(cand);
      } catch (err) {
        if (!this.ignoreOffer) {
          console.warn('[PeerSession] Error flushing queued candidate:', err);
        }
      }
    }
  }

  public triggerIceRestart() {
    if (this.closed) return;
    try {
      this.pc.restartIce();
    } catch { /* unsupported in some older browsers */ }
  }

  /**
   * Channel health probe on visibilitychange to visible, pageshow, or online event.
   */
  public probeChannel(): Promise<boolean> {
    if (this.ctlChannel.readyState !== 'open') {
      this.triggerIceRestart();
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      this.sendCtl({ type: 'probe-ping' });
      this.probeTimeoutTimer = setTimeout(() => {
        this.probeTimeoutTimer = null;
        this.triggerIceRestart();
        resolve(false);
      }, ICE_PROBE_PONG_TIMEOUT_MS);
    });
  }

  public sendCtl(message: unknown) {
    const str = typeof message === 'string' ? message : JSON.stringify(message);
    if (this.ctlChannel.readyState === 'open') {
      this.ctlChannel.send(str);
    } else {
      this.ctlQueue.push(str);
    }
  }

  public sendData(frame: Uint8Array) {
    if (this.dataChannel.readyState === 'open') {
      const buf =
        frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
          ? frame.buffer
          : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      this.dataChannel.send(buf as ArrayBuffer);
    } else {
      throw new Error('Data channel is not open');
    }
  }

  public getBufferedAmount(): number {
    return this.dataChannel ? this.dataChannel.bufferedAmount : 0;
  }

  public waitForBufferedAmountLow(): Promise<void> {
    const dc = this.dataChannel;
    if (!dc || dc.readyState !== 'open' || dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        dc.removeEventListener('bufferedamountlow', done);
        dc.removeEventListener('close', done);
        dc.removeEventListener('error', done);
        clearTimeout(guard);
        resolve();
      };
      // guard: never hang forever if the channel dies mid-wait
      const guard = setTimeout(done, 5000);
      dc.addEventListener('bufferedamountlow', done);
      dc.addEventListener('close', done);
      dc.addEventListener('error', done);
    });
  }

  /** Resolves true once the data channel is open, false on timeout / close. */
  public whenDataOpen(timeoutMs = 20000): Promise<boolean> {
    const dc = this.dataChannel;
    if (dc.readyState === 'open') return Promise.resolve(true);
    if (dc.readyState === 'closing' || dc.readyState === 'closed') return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        dc.removeEventListener('open', onOpen);
        dc.removeEventListener('close', onClose);
        clearTimeout(timer);
        resolve(ok);
      };
      const onOpen = () => finish(true);
      const onClose = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      dc.addEventListener('open', onOpen);
      dc.addEventListener('close', onClose);
    });
  }

  private startStatsPoller() {
    this.statsTimer = setInterval(async () => {
      if (this.closed || this.pc.connectionState !== 'connected') return;
      try {
        const stats = await this.pc.getStats();
        let selectedPair: any = null;

        stats.forEach((report: any) => {
          if (
            report.type === 'candidate-pair' &&
            (report.selected || report.nominated || report.state === 'succeeded')
          ) {
            selectedPair = report;
          }
        });

        if (selectedPair) {
          const localCandidate = (stats as any).get(selectedPair.localCandidateId);
          const remoteCandidate = (stats as any).get(selectedPair.remoteCandidateId);

          let pathType: PathType = 'direct_lan';
          let badgeLabel = 'Direct (same network)';

          if (localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay') {
            pathType = 'turn_relay';
            badgeLabel = 'Relayed (TURN UDP/TCP/TLS)';
          } else if (
            localCandidate?.candidateType === 'srflx' ||
            remoteCandidate?.candidateType === 'srflx'
          ) {
            pathType = 'direct_wan';
            badgeLabel = 'Direct (internet)';
          }

          const rttMs = Math.round((selectedPair.currentRoundTripTime || 0) * 1000);
          const proto = (localCandidate?.protocol || 'udp').toLowerCase() as 'udp' | 'tcp';

          this.options.onPathStats?.({
            pathType,
            badgeLabel,
            protocol: proto,
            rttMs,
            availableBitrateBps: selectedPair.availableOutgoingBitrate,
          });
        }
      } catch { /* poller ignore */ }
    }, STATS_POLL_INTERVAL_MS);
  }

  /**
   * Centralized cleanup (Section 3.6): stops poller, clears timers, closes channels & connection.
   */
  public close() {
    if (this.closed) return;
    this.closed = true;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.probeTimeoutTimer) {
      clearTimeout(this.probeTimeoutTimer);
      this.probeTimeoutTimer = null;
    }

    try { this.ctlChannel.close(); } catch {}
    try { this.dataChannel.close(); } catch {}
    try { this.pc.close(); } catch {}

    this.candidateQueue = [];
  }
}
