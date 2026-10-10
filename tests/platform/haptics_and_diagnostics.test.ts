import { describe, it, expect, vi, beforeEach } from 'vitest';
import { haptics, HAPTIC_PATTERNS } from '../../apps/web/src/haptics/index.js';
import { DiagnosticsRunner } from '../../apps/web/src/diagnostics/index.js';
import { PlatformLifecycleManager } from '../../apps/web/src/platform/index.js';

describe('Phase 7: Haptics Engine, Diagnostics Runner & Platform Lifecycle', () => {
  let vibrateCalls: any[] = [];

  beforeEach(() => {
    vibrateCalls = [];
    Object.defineProperty(globalThis.navigator, 'vibrate', {
      value: vi.fn((pattern) => {
        vibrateCalls.push(pattern);
        return true;
      }),
      configurable: true,
      writable: true,
    });
  });

  it('matches exact Section 6 specifications for all haptic pattern timings', () => {
    expect(HAPTIC_PATTERNS.tap).toEqual([10]);
    expect(HAPTIC_PATTERNS.select).toEqual([8]);
    expect(HAPTIC_PATTERNS.deviceFound).toEqual([12, 30, 12]);
    expect(HAPTIC_PATTERNS.connected).toEqual([12, 30, 18]);
    expect(HAPTIC_PATTERNS.incomingRequest).toEqual([25, 80, 25, 80, 45]);
    expect(HAPTIC_PATTERNS.accepted).toEqual([15, 40, 25]);
    expect(HAPTIC_PATTERNS.progressMilestone).toEqual([6]);
    expect(HAPTIC_PATTERNS.complete).toEqual([20, 50, 20, 50, 70]);
    expect(HAPTIC_PATTERNS.warning).toEqual([35, 60, 35]);
    expect(HAPTIC_PATTERNS.error).toEqual([70, 40, 70, 40, 110]);
    expect(HAPTIC_PATTERNS.cancel).toEqual([20, 40, 20]);
  });

  it('respects intensity settings and rate-limiting in haptic engine', () => {
    haptics.setIntensity('normal');
    haptics.play('tap');

    // Cancels running pattern first with 0, then plays pattern (Section 6)
    expect(vibrateCalls).toContainEqual(0);
    expect(vibrateCalls).toContainEqual([10]);

    // Rate-limiting: consecutive play within 150ms must be throttled
    vibrateCalls = [];
    haptics.play('select');
    expect(vibrateCalls).toHaveLength(0); // Throttled

    // Light intensity halves duration
    haptics.setIntensity('light');
    // Simulate time advancing > 150ms
    (haptics as any).lastPlayedTime = 0;
    haptics.play('tap');
    expect(vibrateCalls).toContainEqual([5]); // 10 / 2 = 5ms

    // Off setting disables vibration
    haptics.setIntensity('off');
    (haptics as any).lastPlayedTime = 0;
    vibrateCalls = [];
    haptics.play('tap');
    expect(vibrateCalls).toHaveLength(0);
  });

  it('runs 10-second diagnostics and generates formatted report with all 4 TURN endpoints', async () => {
    const runner = new DiagnosticsRunner('http://localhost:4000');
    const report = await runner.runFullDiagnostics({ forceRelayOnly: true });

    expect(report.turnTransports.udp3478.reachable).toBe(true);
    expect(report.turnTransports.tcp3478.reachable).toBe(true);
    expect(report.turnTransports.tls5349.reachable).toBe(true);
    expect(report.turnTransports.tls443.reachable).toBe(true);
    expect(report.forceRelayOnly).toBe(true);

    const formatted = runner.formatReportAsText(report);
    expect(formatted).toContain('UDP 3478');
    expect(formatted).toContain('TLS 443');
    expect(formatted).toContain('Force Relay-Only: true');
  });

  it('manages Wake Lock lifecycle and mobile warning banner', async () => {
    let journalFlushed = false;
    let probed = false;

    const mgr = new PlatformLifecycleManager({
      onFlushJournal: () => {
        journalFlushed = true;
      },
      onProbeChannels: () => {
        probed = true;
      },
    });

    await mgr.onTransferStart();
    expect(mgr.shouldShowMobileWarningBanner('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)')).toBe(true);
    expect(mgr.shouldShowMobileWarningBanner('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);

    await mgr.onTransferEnd();
    expect(mgr.shouldShowMobileWarningBanner('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)')).toBe(false);
  });
});
