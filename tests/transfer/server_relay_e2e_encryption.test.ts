import { describe, it, expect, vi } from 'vitest';
import { TrustManager } from '../../apps/web/src/core/trust/index.js';
import { EncryptedServerRelayTransport } from '../../apps/web/src/core/trust/relay_transport.js';

describe('Phase 6: Trust Layer, SAS & E2E Encrypted Server Relay Fallback', () => {
  it('performs ECDH key exchange and computes matching Short Authentication Strings (SAS)', async () => {
    const peerA = new TrustManager();
    const peerB = new TrustManager();

    const pubA = await peerA.init();
    const pubB = await peerB.init();

    // Derive shared keys on both sides
    const keyA = await peerA.deriveSharedKey(pubB);
    const keyB = await peerB.deriveSharedKey(pubA);

    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();

    // Compute SAS with simulated DTLS certificate fingerprints
    const dtlsFingerprintA = '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';
    const dtlsFingerprintB = 'FF:EE:DD:CC:BB:AA:00:99:88:77:66:55:44:33:22:11';

    const sasA = await peerA.computeVerificationSAS(
      dtlsFingerprintA,
      dtlsFingerprintB,
      pubA,
      pubB
    );

    const sasB = await peerB.computeVerificationSAS(
      dtlsFingerprintB, // Reverse order input from peer B's perspective
      dtlsFingerprintA,
      pubB,
      pubA
    );

    // Both peers MUST compute identical numeric 4-digit code and 3 emoji SAS (Section 3.10)
    expect(sasA.sasNumeric).toBe(sasB.sasNumeric);
    expect(sasA.sasNumeric).toMatch(/^\d{4}$/);
    expect(sasA.sasEmoji).toBe(sasB.sasEmoji);
    expect(sasA.sasEmoji.split(' ')).toHaveLength(3);
  });

  it('proves server relay fallback transmits ONLY opaque ciphertext with zero plaintext in server logs', async () => {
    const peerA = new TrustManager();
    const peerB = new TrustManager();

    const pubA = await peerA.init();
    const pubB = await peerB.init();

    await peerA.deriveSharedKey(pubB);
    await peerB.deriveSharedKey(pubA);

    // Simulated plaintext containing sensitive string
    const secretContent = 'TOP_SECRET_FILE_CONTENT_THAT_MUST_NEVER_APPEAR_IN_SERVER_LOGS_OR_WIRE';
    const plainPayload = new TextEncoder().encode(secretContent);

    const interceptedServerLogs: string[] = [];

    let decryptedReceivedPayload: Uint8Array | null = null;
    const transportB = new EncryptedServerRelayTransport(peerB, () => {});

    // Transport A: posts to signaling server relay
    const transportA = new EncryptedServerRelayTransport(peerA, (ciphertextB64) => {
      // The signaling server receives this message
      interceptedServerLogs.push(ciphertextB64);
      // Relay forwards to B
      void transportB.handleIncomingRelayFrame(ciphertextB64);
    });

    const frameReceivedPromise = new Promise<void>((resolve) => {
      transportB.onFrame((frame) => {
        decryptedReceivedPayload = frame;
        resolve();
      });
    });

    // Send payload through encrypted relay transport
    await transportA.send(plainPayload);
    await frameReceivedPromise;

    // 1. Verify that server received message
    expect(interceptedServerLogs.length).toBe(1);
    const serverMessage = interceptedServerLogs[0];

    // 2. CRITICAL ACCEPTANCE CHECK: Server logs MUST NOT contain any plaintext!
    expect(serverMessage).not.toContain('TOP_SECRET');
    expect(serverMessage).not.toContain(secretContent);

    // 3. Decode base64 to prove it is genuine binary AES-GCM ciphertext, not plaintext base64
    const binary = atob(serverMessage);
    expect(binary).not.toContain(secretContent);

    // 4. Verify that recipient successfully decrypted the payload back to the exact original bytes
    expect(decryptedReceivedPayload).not.toBeNull();
    const decryptedText = new TextDecoder().decode(decryptedReceivedPayload!);
    expect(decryptedText).toBe(secretContent);
  });
});
