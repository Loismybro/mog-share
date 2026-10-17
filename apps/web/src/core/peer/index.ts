import {
  ICE_CANDIDATE_POOL_SIZE,
  ICE_DISCONNECTED_GRACE_MS,
  ICE_PROBE_PONG_TIMEOUT_MS,
  STATS_POLL_INTERVAL_MS,
  BUFFERED_AMOUNT_LOW_THRESHOLD,
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
  forceRelay?: boolean;
  onSignal: (signal: PeerSignal) => void;
  onCtlMessage?: (data: unknown) => void;
  onDataFrame?: (frame: Uint8Array) => void;
  onDataOpen?: () => void;
  onPathStats?: (stats: PeerPathStats) => void;
  onConnectionChange?: (state: RTCPeerConnectionState) => void;
}

const PARALLEL_DATA_CHANNEL_COUNT = 4;

export class PeerSession {
  public readonly localDeviceId: string;
  public readonly remoteDeviceId: string;
  public readonly isPolite: boolean;

  private pc: RTCPeerConnection;
  private ctlChannel: RTCDataChannel;
  private dataChannel: RTCDataChannel;
  private dataChannels: RTCDataChannel[] = [];
  private dataRoundRobin = 0;

  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private candidateQueue: RTCIceCandidateInit[] = [];

  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackNegotiationTimer: ReturnType<typeof setTimeout> | null = null;
  private ctlQueue: string[] = [];
  private restartCount = 0;
  private closed = false;

  private options: PeerSessionOptions;

  constructor(options: PeerSessionOptions) {
    this.options = options;
    this.localDeviceId = options.localDeviceId;
    this.remoteDeviceId = options.remoteDeviceId;
    this.isPolite = this.localDeviceId < this.remoteDeviceId;

    const config: RTCConfiguration = {
      iceServers: options.iceServers,
      iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
      bundlePolicy: 'max-bundle',
      iceTransportPolicy: options.forceRelay ? 'relay' : 'all',
    };

    this.pc = new RTCPeerConnection(config);

    // Attach PeerConnection handlers BEFORE createDataChannel so WebKit/iPadOS
    // and Chromium never miss the initial negotiationneeded event!
    this.setupPeerConnectionHandlers();

    this.ctlChannel = this.pc.createDataChannel('ctl', {
      id: 0,
      negotiated: true,
      ordered: true,
    });
    this.ctlChannel.binaryType = 'arraybuffer';

    // Create 4 parallel negotiated high-speed data channels (ids 1..4)
    // unordered: true eliminates SCTP head-of-line blocking on WAN/mobile links
    // because MogShare frames carry explicit (blockIndex, chunkIndex) headers!
    for (let i = 0; i < PARALLEL_DATA_CHANNEL_COUNT; i++) {
      const ch = this.pc.createDataChannel(i === 0 ? 'data' : `data-${i + 1}`, {
        id: i + 1,
        negotiated: true,
        ordered: false,
      });
      ch.binaryType = 'arraybuffer';
      ch.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
      this.dataChannels.push(ch);
    }
    this.dataChannel = this.dataChannels[0];

    this.setupDataChannelHandlers();
    this.startStatsPoller();
    if (this.ctlChannel.readyState === 'open') {
      this.flushCtlQueue();
    }

    if (!this.isPolite) {
      queueMicrotask(() => {
        void this.ensureNegotiationStarted();
      });
    } else {
      this.fallbackNegotiationTimer = setTimeout(() => {
        if (!this.closed && this.pc.signalingState === 'stable' && !this.pc.remoteDescription) {
          void this.ensureNegotiationStarted();
        }
      }, 800);
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

  public isAnyDataOpen(): boolean {
    return this.dataChannels.some((ch) => ch.readyState === 'open');
  }

  public getOpenDataChannelCount(): number {
    return this.dataChannels.filter((ch) => ch.readyState === 'open').length;
  }

  public get rtcPeerConnection(): RTCPeerConnection {
    return this.pc;
  }

  public async ensureNegotiationStarted(): Promise<void> {
    if (
      this.closed ||
      this.makingOffer ||
      this.isAnyDataOpen()
    ) {
      return;
    }
    if (this.pc.signalingState !== 'stable') {
      return;
    }
    try {
      this.makingOffer = true;
      if (
        this.pc.localDescription &&
        this.pc.connectionState !== 'connected' &&
        this.pc.connectionState !== 'connecting'
      ) {
        try {
          this.pc.restartIce();
        } catch {
          /* ignore */
        }
      }
      if (typeof this.pc.createOffer === 'function') {
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== 'stable') return;
        await this.pc.setLocalDescription(offer);
      } else {
        await this.pc.setLocalDescription();
      }
      const serialized = this.serializeSdp(this.pc.localDescription);
      if (serialized) {
        this.options.onSignal({
          type: 'sdp',
          sdp: serialized,
        });
      }
    } catch {
      /* ignore if mock or race */
    } finally {
      this.makingOffer = false;
    }
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
        } catch {
          /* ignore */
        }
      }
      this.options.onCtlMessage?.(ev.data);
    };

    let notifiedOpen = false;
    for (const ch of this.dataChannels) {
      ch.onopen = () => {
        if (!notifiedOpen) {
          notifiedOpen = true;
          this.options.onDataOpen?.();
        }
      };

      ch.onmessage = (ev) => {
        const bytes =
          ev.data instanceof ArrayBuffer
            ? new Uint8Array(ev.data)
            : ev.data instanceof Uint8Array
            ? ev.data
            : new Uint8Array(0);
        if (bytes.byteLength > 0) {
          this.options.onDataFrame?.(bytes);
        }
      };
    }
  }

  private serializeSdp(
    desc: RTCSessionDescriptionInit | RTCSessionDescription | null
  ): RTCSessionDescriptionInit | null {
    if (!desc) return null;
    if (typeof (desc as any).toJSON === 'function') {
      return (desc as any).toJSON();
    }
    return { type: desc.type, sdp: desc.sdp };
  }

  private setupPeerConnectionHandlers() {
    this.pc.onnegotiationneeded = async () => {
      if (this.closed || this.makingOffer) return;
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

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const candInit =
          typeof (ev.candidate as any).toJSON === 'function'
            ? (ev.candidate as any).toJSON()
            : {
                candidate: ev.candidate.candidate,
                sdpMid: ev.candidate.sdpMid,
                sdpMLineIndex: ev.candidate.sdpMLineIndex,
              };
        this.options.onSignal({
          type: 'candidate',
          candidate: candInit,
        });
      }
    };

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
        if (!this.disconnectTimer) {
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (this.pc.connectionState === 'disconnected' && !this.isPolite) {
              this.triggerIceRestart();
            }
          }, ICE_DISCONNECTED_GRACE_MS);
        }
      } else if (state === 'failed') {
        this.restartCount++;
        this.triggerIceRestart();
      }
    };
  }

  public async handleSignal(signal: PeerSignal): Promise<void> {
    if (this.closed) return;

    if (signal.type === 'sdp') {
      const description = signal.sdp;
      const isOffer = description.type === 'offer';
      const offerCollision =
        isOffer && (this.makingOffer || this.pc.signalingState !== 'stable');

      this.ignoreOffer = !this.isPolite && offerCollision;
      if (this.ignoreOffer) {
        return;
      }

      this.isSettingRemoteAnswerPending = description.type === 'answer';
      try {
        if (offerCollision) {
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

      await this.flushCandidateQueue();

      if (isOffer) {
        if (typeof (this.pc as any).createAnswer === 'function' && !(this.pc as any).isMock) {
          try {
            await this.pc.setLocalDescription();
          } catch {
            const ans = await this.pc.createAnswer();
            await this.pc.setLocalDescription(ans);
          }
        } else {
          await this.pc.setLocalDescription();
        }
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
    } catch {
      /* ignore */
    }
  }

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

  /**
   * Stripes binary frames across all 4 parallel WebRTC DataChannels,
   * selecting the channel with the lowest bufferedAmount for maximum throughput!
   */
  public sendData(frame: Uint8Array) {
    const openChannels = this.dataChannels.filter((ch) => ch.readyState === 'open');
    if (openChannels.length > 0) {
      this.dataRoundRobin = (this.dataRoundRobin + 1) % openChannels.length;
      let target = openChannels[this.dataRoundRobin];
      for (const ch of openChannels) {
        if ((ch.bufferedAmount || 0) < (target.bufferedAmount || 0)) {
          target = ch;
        }
      }
      const buf =
        frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
          ? frame.buffer
          : frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      target.send(buf as ArrayBuffer);
    } else {
      throw new Error('Data channel is not open');
    }
  }

  public getBufferedAmount(): number {
    const openChannels = this.dataChannels.filter((ch) => ch.readyState === 'open');
    if (openChannels.length === 0) return 0;
    let minBuffered = Infinity;
    for (const ch of openChannels) {
      const b = ch.bufferedAmount || 0;
      if (b < minBuffered) minBuffered = b;
    }
    return minBuffered === Infinity ? 0 : minBuffered;
  }

  public waitForBufferedAmountLow(): Promise<void> {
    const openChannels = this.dataChannels.filter((ch) => ch.readyState === 'open');
    if (openChannels.length === 0) return Promise.resolve();
    let best = openChannels[0];
    for (const ch of openChannels) {
      if ((ch.bufferedAmount || 0) < (best.bufferedAmount || 0)) {
        best = ch;
      }
    }
    if ((best.bufferedAmount || 0) <= (best.bufferedAmountLowThreshold || BUFFERED_AMOUNT_LOW_THRESHOLD)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        best.removeEventListener('bufferedamountlow', done);
        best.removeEventListener('close', done);
        best.removeEventListener('error', done);
        clearTimeout(guard);
        resolve();
      };
      const guard = setTimeout(done, 1200);
      best.addEventListener('bufferedamountlow', done);
      best.addEventListener('close', done);
      best.addEventListener('error', done);
    });
  }

  public whenDataOpen(timeoutMs = 6000): Promise<boolean> {
    if (this.isAnyDataOpen()) return Promise.resolve(true);
    const dc = this.dataChannel;
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
          let badgeLabel = 'Local Wi-Fi (Zero Data)';

          if (
            localCandidate?.candidateType === 'relay' ||
            remoteCandidate?.candidateType === 'relay'
          ) {
            pathType = 'turn_relay';
            badgeLabel = 'Cloud Relay';
          } else if (
            localCandidate?.candidateType === 'srflx' ||
            remoteCandidate?.candidateType === 'srflx'
          ) {
            pathType = 'direct_wan';
            badgeLabel = 'Direct P2P';
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
      } catch {
        /* poller ignore */
      }
    }, STATS_POLL_INTERVAL_MS);
  }

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
    if (this.fallbackNegotiationTimer) {
      clearTimeout(this.fallbackNegotiationTimer);
      this.fallbackNegotiationTimer = null;
    }

    try {
      this.ctlChannel.close();
    } catch {}
    for (const ch of this.dataChannels) {
      try {
        ch.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}

    this.candidateQueue = [];
  }
}
