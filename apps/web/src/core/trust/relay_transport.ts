import type { TrustManager } from './index.js';

export interface Transport {
  send(frame: Uint8Array): Promise<void>;
  onFrame(cb: (frame: Uint8Array) => void): void;
  getBufferedAmount(): number;
  onDrain(cb: () => void): void;
  close(): void;
}

export class EncryptedServerRelayTransport implements Transport {
  private trust: TrustManager;
  private sendSignalFrame: (ciphertextB64: string) => void;
  private frameCallback: ((frame: Uint8Array) => void) | null = null;
  private drainCallback: (() => void) | null = null;
  private closed = false;

  constructor(
    trust: TrustManager,
    sendSignalFrame: (ciphertextB64: string) => void
  ) {
    this.trust = trust;
    this.sendSignalFrame = sendSignalFrame;
  }

  public async send(frame: Uint8Array): Promise<void> {
    if (this.closed) return;
    const encrypted = await this.trust.encryptFrame(frame);

    // Convert to binary string / base64 for signaling message
    let binary = '';
    for (let i = 0; i < encrypted.length; i++) {
      binary += String.fromCharCode(encrypted[i]);
    }
    const b64 = btoa(binary);

    this.sendSignalFrame(b64);
  }

  public async handleIncomingRelayFrame(ciphertextB64: string): Promise<void> {
    if (this.closed || !this.frameCallback) return;

    const binary = atob(ciphertextB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const decrypted = await this.trust.decryptFrame(bytes);
    this.frameCallback(decrypted);
  }

  public onFrame(cb: (frame: Uint8Array) => void): void {
    this.frameCallback = cb;
  }

  public getBufferedAmount(): number {
    return 0;
  }

  public onDrain(cb: () => void): void {
    this.drainCallback = cb;
  }

  public close(): void {
    this.closed = true;
    this.frameCallback = null;
    this.drainCallback = null;
  }
}
