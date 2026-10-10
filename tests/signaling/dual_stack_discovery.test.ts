import { describe, it, expect, beforeEach } from 'vitest';
import { LocalGroupIndex } from '../../apps/signaling/src/groups/index.js';
import { deriveNetworkKey } from '../../apps/signaling/src/clientip/index.js';
import { RoomManager } from '../../apps/signaling/src/rooms/index.js';

describe('Phase 2 Signaling Server: Dual-Stack Local Group Discovery & Rooms', () => {
  const SERVER_SALT = 'test_salt_random_bytes_123';
  let groupIndex: LocalGroupIndex;
  let roomManager: RoomManager;

  beforeEach(() => {
    groupIndex = new LocalGroupIndex();
    roomManager = new RoomManager();
  });

  it('proves that two devices on the same Wi-Fi (one v4, one v6) appear in each others list', () => {
    // Scenario:
    // Device A (e.g. Laptop) connects via IPv4: 203.0.113.45
    // Laptop also probed IPv6 endpoint and got: 2001:db8:abcd:1234:5678:9abc:def0:1234
    // Device B (e.g. iPhone) connects via IPv6: 2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd
    // Notice both share the IPv6 /64 prefix (2001:db8:abcd:1234::/64)!

    const laptopV4Key = deriveNetworkKey('203.0.113.45', SERVER_SALT);
    const laptopV6Key = deriveNetworkKey('2001:db8:abcd:1234:5678:9abc:def0:1234', SERVER_SALT);

    const iphoneV6Key = deriveNetworkKey('2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd', SERVER_SALT);

    // Because /64 prefix is identical, the derived IPv6 group keys match!
    expect(laptopV6Key).toBe(iphoneV6Key);

    // Register Laptop with its keys
    groupIndex.registerDevice({
      deviceId: 'dev_laptop_1',
      name: 'Brave Lion',
      platform: 'macos',
      networkKeys: new Set([laptopV4Key, laptopV6Key]),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      heartbeatComplete: false,
      resumeToken: 'token_laptop',
    });

    // Register iPhone with its IPv6 key
    groupIndex.registerDevice({
      deviceId: 'dev_iphone_2',
      name: 'Swift Falcon',
      platform: 'ios',
      networkKeys: new Set([iphoneV6Key]),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      heartbeatComplete: false,
      resumeToken: 'token_iphone',
    });

    // Before heartbeat completes, neither device should appear to others
    expect(groupIndex.getVisiblePeers('dev_laptop_1')).toHaveLength(0);
    expect(groupIndex.getVisiblePeers('dev_iphone_2')).toHaveLength(0);

    // Complete heartbeat ping/pong round trip for both
    groupIndex.markHeartbeatComplete('dev_laptop_1');
    groupIndex.markHeartbeatComplete('dev_iphone_2');

    // Now both devices appear in each other's visible list!
    const visibleToLaptop = groupIndex.getVisiblePeers('dev_laptop_1');
    const visibleToIPhone = groupIndex.getVisiblePeers('dev_iphone_2');

    expect(visibleToLaptop).toHaveLength(1);
    expect(visibleToLaptop[0].deviceId).toBe('dev_iphone_2');
    expect(visibleToLaptop[0].name).toBe('Swift Falcon');

    expect(visibleToIPhone).toHaveLength(1);
    expect(visibleToIPhone[0].deviceId).toBe('dev_laptop_1');
    expect(visibleToIPhone[0].name).toBe('Brave Lion');
  });

  it('enforces room creation, 8-char codes, and rate-limiting', () => {
    const room = roomManager.createRoom('dev_host');
    expect(room.code).toHaveLength(8);
    expect(room.peerIds.has('dev_host')).toBe(true);

    // Test join
    const joinRes = roomManager.joinRoom(room.code, 'dev_guest');
    expect(joinRes.success).toBe(true);
    expect(joinRes.room?.peerIds.has('dev_guest')).toBe(true);

    // Test rate limiter after 10 failed joins
    const ipHash = 'sample_ip_hash';
    for (let i = 0; i < 10; i++) {
      roomManager.recordJoinFailure(ipHash, 'WRONGCOD');
    }
    const check = roomManager.checkRateLimit(ipHash, 'WRONGCOD');
    expect(check.allowed).toBe(false);
    expect(check.remainingLockoutMs).toBeGreaterThan(0);
  });

  it('restores sessions using resume token on reconnect', () => {
    const key = deriveNetworkKey('192.168.1.100', SERVER_SALT);
    groupIndex.registerDevice({
      deviceId: 'dev_resuming',
      name: 'Clever Fox',
      platform: 'linux',
      networkKeys: new Set([key]),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      heartbeatComplete: true,
      resumeToken: 'token_secret_123',
    });

    const session = groupIndex.getSessionByToken('token_secret_123');
    expect(session).toBeDefined();
    expect(session?.deviceId).toBe('dev_resuming');
  });

  it('tracks room active counts and memberships accurately', () => {
    expect(roomManager.getActiveRoomCount()).toBe(0);
    const room1 = roomManager.createRoom('dev_user_1');
    const room2 = roomManager.createRoom('dev_user_2');
    expect(roomManager.getActiveRoomCount()).toBe(2);

    roomManager.joinRoom(room1.code, 'dev_user_2');
    const user2Rooms = roomManager.getRoomsForDevice('dev_user_2');
    expect(user2Rooms).toHaveLength(2);

    roomManager.leaveRoom(room1.code, 'dev_user_1');
    expect(roomManager.getActiveRoomCount()).toBe(2); // still has user 2

    roomManager.leaveRoom(room1.code, 'dev_user_2');
    expect(roomManager.getActiveRoomCount()).toBe(1); // empty room deleted

    roomManager.leaveRoom(room2.code, 'dev_user_2');
    expect(roomManager.getActiveRoomCount()).toBe(0);
  });

  it('exposes correct metrics and device counts', () => {
    expect(groupIndex.getDeviceCount()).toBe(0);
    const key = deriveNetworkKey('192.168.1.1', SERVER_SALT);
    groupIndex.registerDevice({
      deviceId: 'dev_1',
      name: 'Tester',
      platform: 'web',
      networkKeys: new Set([key]),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      heartbeatComplete: true,
      resumeToken: 'tok1',
    });
    expect(groupIndex.getDeviceCount()).toBe(1);
    groupIndex.removeDevice('dev_1');
    expect(groupIndex.getDeviceCount()).toBe(0);
  });
});
