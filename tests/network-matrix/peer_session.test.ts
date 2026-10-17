import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerSession, type PeerSignal, type PeerPathStats } from '../../apps/web/src/core/peer/index.js';
import { ConnectionLadderOrchestrator } from '../../apps/web/src/core/path/index.js';

// Mock WebRTC environment for Node.js unit testing
class MockRTCDataChannel {
  public id: number;
  public readyState = 'open';
  public binaryType = 'arraybuffer';
  public onmessage: ((ev: any) => void) | null = null;
  public onopen: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public sentMessages: any[] = [];

  constructor(public label: string, options: any) {
    this.id = options?.id ?? 0;
  }

  send(data: any) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 'closed';
  }
}

class MockRTCPeerConnection {
  public connectionState: RTCPeerConnectionState = 'new';
  public iceConnectionState: RTCIceConnectionState = 'new';
  public signalingState: RTCSignalingState = 'stable';
  public localDescription: RTCSessionDescriptionInit | null = null;
  public remoteDescription: RTCSessionDescriptionInit | null = null;
  public iceTransportPolicy: string;
  public addedCandidates: any[] = [];
  public restartedIce = false;

  public onnegotiationneeded: (() => void) | null = null;
  public onicecandidate: ((ev: any) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;

  constructor(public config: any) {
    this.iceTransportPolicy = config.iceTransportPolicy || 'all';
  }

  createDataChannel(label: string, options: any) {
    return new MockRTCDataChannel(label, options);
  }

  async setLocalDescription(desc?: any) {
    if (desc?.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      return;
    }
    this.localDescription = desc || { type: 'offer', sdp: 'mock_local_sdp' };
    this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(cand: any) {
    this.addedCandidates.push(cand);
  }

  restartIce() {
    this.restartedIce = true;
  }

  async getStats() {
    return new Map();
  }

  close() {
    this.connectionState = 'closed';
  }
}

describe('Phase 3: PeerSession with Perfect Negotiation & Path Badge', () => {
  beforeEach(() => {
    (globalThis as any).RTCPeerConnection = MockRTCPeerConnection;
    (globalThis as any).RTCDataChannel = MockRTCDataChannel;
  });

  it('determines politeness deterministically by lexicographical device ID comparison', () => {
    const politeSession = new PeerSession({
      localDeviceId: 'device_001',
      remoteDeviceId: 'device_999',
      iceServers: [],
      onSignal: vi.fn(),
    });
    expect(politeSession.isPolite).toBe(true);
    politeSession.close();

    const impoliteSession = new PeerSession({
      localDeviceId: 'device_999',
      remoteDeviceId: 'device_001',
      iceServers: [],
      onSignal: vi.fn(),
    });
    expect(impoliteSession.isPolite).toBe(false);
    impoliteSession.close();
  });

  it('configures TURN-only forced relay mode properly for diagnostics and restricted networks', () => {
    const relaySession = new PeerSession({
      localDeviceId: 'device_a',
      remoteDeviceId: 'device_b',
      iceServers: [{ urls: 'turn:turn.example.com:3478' }],
      forceRelay: true,
      onSignal: vi.fn(),
    });

    const mockPc = relaySession.rtcPeerConnection as unknown as MockRTCPeerConnection;
    expect(mockPc.iceTransportPolicy).toBe('relay');
    relaySession.close();
  });

  it('queues remote ICE candidates until setRemoteDescription completes, then flushes', async () => {
    const session = new PeerSession({
      localDeviceId: 'device_a',
      remoteDeviceId: 'device_b',
      iceServers: [],
      onSignal: vi.fn(),
    });
    const mockPc = session.rtcPeerConnection as unknown as MockRTCPeerConnection;

    // Candidate arrives before remote description
    const candidate1 = { candidate: 'candidate:1 ...', sdpMid: '0', sdpMLineIndex: 0 };
    await session.handleSignal({ type: 'candidate', candidate: candidate1 });

    // Should be queued, not added to PC yet
    expect(mockPc.addedCandidates).toHaveLength(0);

    // Now remote offer arrives
    const remoteOffer = { type: 'offer' as const, sdp: 'mock_remote_offer' };
    await session.handleSignal({ type: 'sdp', sdp: remoteOffer });

    // After setRemoteDescription, the candidate queue must be flushed!
    expect(mockPc.addedCandidates).toHaveLength(1);
    expect(mockPc.addedCandidates[0]).toEqual(candidate1);

    session.close();
  });

  it('manages connection ladder orchestration and path badge states', () => {
    const badges: string[] = [];
    const statuses: string[] = [];

    const orchestrator = new ConnectionLadderOrchestrator({
      onStatusChange: (s) => statuses.push(s),
      onPathBadgeChange: (b) => badges.push(b),
      onStats: vi.fn(),
    });

    // Test Path badge state updates
    orchestrator.handlePathStats({
      pathType: 'direct_lan',
      badgeLabel: 'Direct (same network)',
      protocol: 'udp',
      rttMs: 2,
    });
    expect(badges).toContain('Direct (same network)');

    orchestrator.handlePathStats({
      pathType: 'turn_relay',
      badgeLabel: 'Relayed (TURN UDP/TCP/TLS)',
      protocol: 'tcp',
      rttMs: 45,
    });
    expect(badges).toContain('Relayed (TURN UDP/TCP/TLS)');

    // Fallback to Server Relay
    orchestrator.startServerRelayFallback();
    expect(badges).toContain('Server relay (encrypted)');

    orchestrator.destroy();
  });

  it('buffers control messages until ctlChannel is open', () => {
    class ConnectingDataChannel extends MockRTCDataChannel {
      constructor(label: string, options: any) {
        super(label, options);
        this.readyState = 'connecting';
      }
    }
    class ConnectingPeerConnection extends MockRTCPeerConnection {
      createDataChannel(label: string, options: any) {
        return new ConnectingDataChannel(label, options);
      }
    }
    (globalThis as any).RTCPeerConnection = ConnectingPeerConnection;

    const session = new PeerSession({
      localDeviceId: 'dev_1',
      remoteDeviceId: 'dev_2',
      iceServers: [],
      onSignal: vi.fn(),
    });

    const ctlChannel = session.ctl as unknown as ConnectingDataChannel;
    expect(ctlChannel.readyState).toBe('connecting');

    session.sendCtl({ type: 'request-transfer', payload: { test: true } });
    expect(ctlChannel.sentMessages).toHaveLength(0);

    ctlChannel.readyState = 'open';
    ctlChannel.onopen?.();

    expect(ctlChannel.sentMessages).toHaveLength(1);
    expect(ctlChannel.sentMessages[0]).toContain('request-transfer');
    session.close();
  });
});
