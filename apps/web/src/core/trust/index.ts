import { computeSAS } from '@shareapp/shared';

export interface TrustState {
  sasNumeric: string;
  sasEmoji: string;
  isTrusted: boolean;
}

export class TrustManager {
  private keyPair: CryptoKeyPair | null = null;
  private peerPublicKeyRaw: string | null = null;
  private derivedKey: CryptoKey | null = null;
  private trustedDevicesKey = 'shareapp_trusted_keys';

  public async init(): Promise<string> {
    // Generate ECDH P-256 key pair
    this.keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    // Export public key as base64 string
    const rawPub = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    return this.bufferToBase64(rawPub);
  }

  public async deriveSharedKey(peerPublicKeyBase64: string): Promise<CryptoKey> {
    if (!this.keyPair) throw new Error('TrustManager not initialized');
    this.peerPublicKeyRaw = peerPublicKeyBase64;

    const peerKeyBuffer = this.base64ToBuffer(peerPublicKeyBase64);
    const importedPeerKey = await crypto.subtle.importKey(
      'raw',
      peerKeyBuffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    this.derivedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: importedPeerKey },
      this.keyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return this.derivedKey;
  }

  public async computeVerificationSAS(
    localDtlsFingerprint: string,
    remoteDtlsFingerprint: string,
    localEcdhPub: string,
    remoteEcdhPub: string
  ): Promise<TrustState> {
    const { numeric, emoji } = await computeSAS(
      localDtlsFingerprint,
      remoteDtlsFingerprint,
      localEcdhPub,
      remoteEcdhPub
    );

    const isTrusted = this.isPeerTrusted(remoteEcdhPub);
    return {
      sasNumeric: numeric,
      sasEmoji: emoji,
      isTrusted,
    };
  }

  public trustDevice(peerPublicKeyBase64: string) {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = JSON.parse(localStorage.getItem(this.trustedDevicesKey) || '[]');
      if (!stored.includes(peerPublicKeyBase64)) {
        stored.push(peerPublicKeyBase64);
        localStorage.setItem(this.trustedDevicesKey, JSON.stringify(stored));
      }
    } catch { /* ignore */ }
  }

  public isPeerTrusted(peerPublicKeyBase64: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      const stored = JSON.parse(localStorage.getItem(this.trustedDevicesKey) || '[]');
      return stored.includes(peerPublicKeyBase64);
    } catch {
      return false;
    }
  }

  /**
   * Encrypts arbitrary binary frame with AES-256-GCM (Section 3.9).
   * Frame layout: [12-byte IV][ciphertext + 16-byte auth tag]
   */
  public async encryptFrame(frame: Uint8Array): Promise<Uint8Array> {
    if (!this.derivedKey) throw new Error('Shared key not derived');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.derivedKey,
      frame
    );
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), 12);
    return out;
  }

  /**
   * Decrypts AES-256-GCM frame.
   */
  public async decryptFrame(encryptedFrame: Uint8Array): Promise<Uint8Array> {
    if (!this.derivedKey) throw new Error('Shared key not derived');
    if (encryptedFrame.byteLength < 28) {
      throw new Error('Encrypted frame too short');
    }
    const iv = encryptedFrame.subarray(0, 12);
    const ct = encryptedFrame.subarray(12);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.derivedKey,
      ct
    );
    return new Uint8Array(pt);
  }

  private bufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  private base64ToBuffer(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
}
