import { computeSAS } from '@shareapp/shared';

export interface TrustState {
  sasNumeric: string;
  sasEmoji: string;
  isTrusted: boolean;
}

export class TrustManager {
  private keyPair: CryptoKeyPair | null = null;
  private publicKeyBase64: string | null = null;
  private initPromise: Promise<string> | null = null;
  private peerPublicKeyRaw: string | null = null;
  private derivedKey: CryptoKey | null = null;
  private trustedDevicesKey = 'shareapp_trusted_keys';

  /**
   * Idempotent initialization: caches the keypair generation promise so concurrent
   * calls never overwrite the local ECDH keypair during handshake.
   */
  public init(): Promise<string> {
    if (this.publicKeyBase64 && this.keyPair) {
      return Promise.resolve(this.publicKeyBase64);
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
      );
      const rawPub = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
      this.publicKeyBase64 = this.bufferToBase64(rawPub);
      return this.publicKeyBase64;
    })();

    return this.initPromise;
  }

  public async deriveSharedKey(peerPublicKeyBase64: string): Promise<CryptoKey> {
    if (!this.keyPair) {
      await this.init();
    }
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

  public getPeerPublicKey(): string | null {
    return this.peerPublicKeyRaw;
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
    } catch {
      /* ignore */
    }
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

  public async encryptFrame(frame: Uint8Array): Promise<Uint8Array> {
    if (!this.derivedKey) throw new Error('Shared key not derived');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      this.derivedKey,
      frame as unknown as BufferSource
    );
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), 12);
    return out;
  }

  public async decryptFrame(encryptedFrame: Uint8Array): Promise<Uint8Array> {
    if (!this.derivedKey) throw new Error('Shared key not derived');
    if (encryptedFrame.byteLength < 28) {
      throw new Error('Encrypted frame too short');
    }
    const iv = encryptedFrame.subarray(0, 12);
    const ct = encryptedFrame.subarray(12);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      this.derivedKey,
      ct as unknown as BufferSource
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
