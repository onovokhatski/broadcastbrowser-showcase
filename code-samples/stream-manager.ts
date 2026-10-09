import type { WebContents } from 'electron';
import type { StreamSettings } from '../../plugin-api/contract';
import type { PluginHost } from '../plugin-host/plugin-host';
import { computeOsrScale } from './frame-util';
import { log } from '../logger';

/**
 * StreamManager — captures frames from a live tab's webContents and fans them
 * out to attached plugins through PluginHost.
 *
 * Primary path: webContents.beginFrameSubscription — the compositor hands us a
 * frame on every actual paint. This is cheap and evenly paced, so high frame
 * rates (60 fps) are achievable; a timer + capturePage() round-trip costs
 * ~20 ms per frame and tops out around 45–50 fps with a ragged cadence.
 *
 * Fallback path: the compositor only paints when something changes and only
 * while the view is visible. A watchdog timer notices when subscription frames
 * stop arriving (static page, hidden/background tab) and falls back to
 * capturePage() at the target rate so the stream never freezes.
 *
 * The tab keeps rendering even when the user switches to another tab
 * (backgroundThrottling is disabled for the duration of the capture).
 */

export interface StreamConfig {
  streamId: string;
  webContents: WebContents;
  width: number;
  height: number;
  fps: number;
  hasAlpha: boolean;
  audioEnabled: boolean;
}

export class StreamManager {
  private timer: NodeJS.Timeout | null = null;
  private capturing = false;
  private readonly hosts = new Set<PluginHost>();
  private sequence = 0;
  private actualWidth: number;
  private actualHeight: number;
  private prevThrottling: boolean | undefined;
  private subscribed = false;
  /** When the last frame (from either path) was pushed to hosts. */
  private lastPushAt = 0;
  /** When the compositor last produced a frame (even if we skipped it). */
  private lastSubFrameAt = 0;
  // Diagnostics: which path produced pushed frames (logged periodically).
  private subPushed = 0;
  private fbPushed = 0;
  private skipped = 0;
  private lastStatsAt = 0;

  constructor(private readonly config: StreamConfig) {
    this.actualWidth = config.width;
    this.actualHeight = config.height;
  }

  getSettings(): StreamSettings {
    return {
      width: this.actualWidth,
      height: this.actualHeight,
      fps: this.config.fps,
      hasAlpha: this.config.hasAlpha,
      audioEnabled: this.config.audioEnabled,
      sampleRate: 48000,
      channels: 2,
    };
  }

  attachHost(host: PluginHost): void {
    this.hosts.add(host);
  }

  detachHost(host: PluginHost): void {
    this.hosts.delete(host);
  }

  async start(): Promise<void> {
    const wc = this.config.webContents;
    this.prevThrottling = wc.backgroundThrottling;
    wc.backgroundThrottling = false;
    const interval = Math.round(1000 / this.config.fps);

    // Compositor-driven capture (primary). May be unavailable on some targets —
    // then the watchdog below simply always runs the capturePage path.
    try {
      wc.beginFrameSubscription(false, (image) => this.onCompositorFrame(image));
      this.subscribed = true;
    } catch {
      this.subscribed = false;
    }

    // Watchdog + fallback: if the compositor stays silent for over ~1.5
    // intervals (static content, occluded view), capture via capturePage so
    // the NDI stream keeps flowing at the target rate.
    this.timer = setInterval(() => {
      if (Date.now() - this.lastSubFrameAt < interval * 1.5) return;
      this.capture();
    }, interval);
  }

  private onCompositorFrame(image: Electron.NativeImage): void {
    this.lastSubFrameAt = Date.now();
    if (this.hosts.size === 0) return;
    // The compositor can paint faster than the target fps (e.g. 120 Hz
    // displays, busy pages). Rate-limit pushes to the configured interval;
    // a small tolerance keeps us from skipping frames on scheduler jitter.
    const interval = 1000 / this.config.fps;
    if (this.lastSubFrameAt - this.lastPushAt < interval - 3) { this.skipped++; return; }
    this.lastPushAt = this.lastSubFrameAt;
    this.subPushed++;
    this.logStats();
    this.processFrame(image);
  }

  /** Periodic one-line source stats: compositor vs fallback vs rate-skipped. */
  private logStats(): void {
    const now = Date.now();
    if (this.lastStatsAt === 0) this.lastStatsAt = now;
    if (now - this.lastStatsAt < 5000) return;
    this.lastStatsAt = now;
    log.info('stream', `capture src: sub=${this.subPushed} fallback=${this.fbPushed} skipped=${this.skipped}`);
    this.subPushed = 0; this.fbPushed = 0; this.skipped = 0;
  }

  private capture(): void {
    if (this.capturing || this.hosts.size === 0) return;
    const wc = this.config.webContents;
    if (wc.isDestroyed()) return;
    this.capturing = true;
    wc.capturePage()
      .then((image) => {
        this.capturing = false;
        // capturePage takes ~20 ms; if a compositor frame got pushed while we
        // were capturing, this frame is stale — pushing it would create a
        // close-spaced burst the sender can't keep up with. Discard it.
        const now = Date.now();
        if (now - this.lastPushAt < (1000 / this.config.fps) * 0.8) return;
        this.lastPushAt = now;
        this.fbPushed++;
        this.logStats();
        this.processFrame(image);
      })
      .catch(() => {
        this.capturing = false;
      });
  }

  private processFrame(image: Electron.NativeImage): void {
    if (this.hosts.size === 0) return;
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;

    const bitmap = image.toBitmap();
    const scale = computeOsrScale(bitmap.byteLength, size.width, size.height);
    this.actualWidth = size.width * scale;
    this.actualHeight = size.height * scale;

    const seq = this.sequence++;
    const ts = Date.now();
    const hosts = [...this.hosts];

    const baseAB =
      bitmap.byteOffset === 0 && bitmap.byteLength === bitmap.buffer.byteLength
        ? (bitmap.buffer as ArrayBuffer)
        : (bitmap.buffer.slice(
            bitmap.byteOffset,
            bitmap.byteOffset + bitmap.byteLength,
          ) as ArrayBuffer);

    hosts.forEach((host, i) => {
      const ab = i === hosts.length - 1 ? baseAB : baseAB.slice(0);
      host.pushFrame({
        sequenceNumber: seq,
        timestamp: ts,
        width: this.actualWidth,
        height: this.actualHeight,
        hasAlpha: this.config.hasAlpha,
        buffer: ab,
      });
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const wc = this.config.webContents;
    if (!wc.isDestroyed()) {
      if (this.subscribed) {
        try { wc.endFrameSubscription(); } catch { /* already gone */ }
      }
      if (this.prevThrottling !== undefined) {
        wc.backgroundThrottling = this.prevThrottling;
      }
    }
    this.subscribed = false;
  }
}
