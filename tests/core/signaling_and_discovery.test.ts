import { describe, it, expect } from 'vitest';
import {
  extractIpv6Prefix64,
  generateEphemeralDeviceId,
  generateFriendlyName,
} from '../../apps/web/src/core/discovery/index.js';
import {
  computeBlockHash,
  computeRootHash,
  verifyRootHash,
} from '../../apps/web/src/transfer/integrity/index.js';
import {
  MemoryBlockWriter,
  pickStorageStrategy,
} from '../../apps/web/src/transfer/storage/index.js';
import { normalizeRoomCode } from '../../apps/web/src/services/network.js';
import { detectDeviceProfileSync } from '../../apps/web/src/utils/deviceDetector.js';
import {
  deriveNetworkKeySet,
  isPrivateOrLocalIp,
} from '../../apps/signaling/src/clientip/index.js';
import { ROOM_CODE_LENGTH } from '@shareapp/shared';

describe('Signaling, Discovery, Auto-Device Detection & Integrity Subsystems', () => {
  it('correctly normalizes 8-character room codes according to Section 3.4 alphabet', () => {
    expect(normalizeRoomCode('#room=ABCDEFGH')).toBe('ABCDEFGH');
    expect(normalizeRoomCode('http://app.example.com/#ABCDEFGH')).toBe('ABCDEFGH');
    expect(normalizeRoomCode('23456789extra')).toBe('23456789');
    expect(normalizeRoomCode('23456789').length).toBe(ROOM_CODE_LENGTH);
    expect(normalizeRoomCode('01IOABCDEFGH')).toBe('ABCDEFGH');
  });

  it('generates 128-bit random ephemeral device IDs and friendly names', () => {
    const id1 = generateEphemeralDeviceId();
    const id2 = generateEphemeralDeviceId();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBeGreaterThanOrEqual(16);

    const name = generateFriendlyName();
    expect(name.split(' ')).toHaveLength(2);
  });

  it('auto-detects device profile synchronously in any environment', () => {
    const profile = detectDeviceProfileSync();
    expect(profile.platform).toBeDefined();
    expect(profile.suggestedName.length).toBeGreaterThan(2);
    expect(profile.connectionLabel).toBeDefined();
  });

  it('groups localhost and private LAN / hotspot IPs into a shared local-lan key set', () => {
    expect(isPrivateOrLocalIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('192.168.1.45')).toBe(true);
    expect(isPrivateOrLocalIp('172.20.10.2')).toBe(true);
    expect(isPrivateOrLocalIp('8.8.8.8')).toBe(false);

    const salt = 'test-salt-99';
    const laptopKeys = deriveNetworkKeySet('127.0.0.1', salt, ['local-lan']);
    const phoneKeys = deriveNetworkKeySet('192.168.1.88', salt, ['v4:192.168.1.88']);

    const overlap = Array.from(laptopKeys).filter((k) => phoneKeys.has(k));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('groups mobile hotspot host and tethered client across CGNAT pools and 3GPP /48 IPv6 prefixes', () => {
    const salt = 'hotspot-salt-42';

    // Case 1: Phone hotspot host on cellular IPv6 (2409:40c0:1a2b:8001::1) + CGNAT IPv4 (49.36.120.14),
    // Tethered client on adjacent 3GPP /64 (2409:40c0:1a2b:8002::5) or CGNAT IPv4 pool (49.36.120.89)
    const hostKeys = deriveNetworkKeySet('2409:40c0:1a2b:8001::1', salt, [
      'v4:49.36.120.14',
      'v4sub24:192.168.43',
    ]);
    const tetheredV4Keys = deriveNetworkKeySet('49.36.120.89', salt, ['v4:49.36.120.89']);
    const tetheredV6Keys = deriveNetworkKeySet('2409:40c0:1a2b:8002::5', salt, [
      'v6:2409:40c0:1a2b:8002',
    ]);

    const overlapV4 = Array.from(hostKeys).filter((k) => tetheredV4Keys.has(k));
    const overlapV6 = Array.from(hostKeys).filter((k) => tetheredV6Keys.has(k));

    expect(overlapV4.length).toBeGreaterThan(0);
    expect(overlapV6.length).toBeGreaterThan(0);
  });


  it('extracts /64 prefix correctly for diverse IPv6 address formats', () => {
    const fullV6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    expect(extractIpv6Prefix64(fullV6)).toBe('2001:0db8:85a3:0000');

    const compressed = '2001:db8:abcd:1234::5678';
    expect(extractIpv6Prefix64(compressed)).toBe('2001:0db8:abcd:1234');
  });

  it('computes per-block hashes and root hash-of-hashes (Section 4.7)', async () => {
    const block1 = new TextEncoder().encode('Block 1 content payload here');
    const block2 = new TextEncoder().encode('Block 2 content payload here');

    const hash1 = await computeBlockHash(block1);
    const hash2 = await computeBlockHash(block2);

    expect(hash1).toHaveLength(64);
    expect(hash2).toHaveLength(64);
    expect(hash1).not.toBe(hash2);

    const rootHash = await computeRootHash([hash1, hash2]);
    expect(rootHash).toHaveLength(64);

    const isValid = await verifyRootHash([hash1, hash2], rootHash);
    expect(isValid).toBe(true);

    const isInvalid = await verifyRootHash([hash2, hash1], rootHash);
    expect(isInvalid).toBe(false);
  });

  it('selects storage writer strategy and respects 200 MB memory limit (Section 4.6)', () => {
    const smallFile = pickStorageStrategy(50 * 1024 * 1024);
    expect(smallFile.strategy).toBe('memory');
    expect(smallFile.warning).toBeUndefined();

    const warnFile = pickStorageStrategy(150 * 1024 * 1024);
    expect(warnFile.strategy).toBe('memory');
    expect(warnFile.warning).toContain('High memory usage');

    expect(() => pickStorageStrategy(250 * 1024 * 1024)).toThrow(/200 MB memory ceiling/);
  });

  it('MemoryBlockWriter correctly writes out-of-order blocks and finalizes blob', async () => {
    const writer = new MemoryBlockWriter('text/plain');
    const part2 = new TextEncoder().encode('World!');
    const part1 = new TextEncoder().encode('Hello ');

    await writer.writeBlock(1, 6, part2);
    await writer.writeBlock(0, 6, part1);

    const blob = await writer.finalize();
    expect(blob).toBeInstanceOf(Blob);
    const text = await blob.text();
    expect(text).toBe('Hello World!');
  });
});
