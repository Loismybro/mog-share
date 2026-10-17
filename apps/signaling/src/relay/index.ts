export class RelayBandwidthLimiter {
  private bytesRelayedPerSession = new Map<string, number>();
  // Max relayed bytes per session: default 2 GB
  private maxBytesPerSession = 2 * 1024 * 1024 * 1024;

  public canRelay(sessionId: string, bytes: number): boolean {
    const current = this.bytesRelayedPerSession.get(sessionId) || 0;
    if (current + bytes > this.maxBytesPerSession) {
      return false;
    }
    this.bytesRelayedPerSession.set(sessionId, current + bytes);
    return true;
  }

  public getRelayedBytes(sessionId: string): number {
    return this.bytesRelayedPerSession.get(sessionId) || 0;
  }

  public reset(sessionId: string) {
    this.bytesRelayedPerSession.delete(sessionId);
  }
}
