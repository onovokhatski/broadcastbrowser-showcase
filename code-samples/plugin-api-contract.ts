/**
 * Plugin API — final contract (Phase 2).
 *
 * This is the full typed surface available to a plugin through the global `bb`
 * object. The browser contains no domain code — all NDI/Spout/Syphon/OSC logic
 * lives in plugins and talks to the browser only through this API.
 *
 * Matches the "BroadcastBrowser Plugin API Contract v1.0" document.
 */

// ---------------------------------------------------------------------------
// Permissions and plan
// ---------------------------------------------------------------------------

export type Permission =
  | 'stream.video'
  | 'stream.audio'
  | 'network.local'
  | 'network.internet'
  | 'page.read'
  | 'page.interact'
  | 'page.script'
  | 'storage'
  | 'ui.panel'
  | 'ui.page'
  | 'license'
  | 'tabs.read';

export type Plan = 'free' | 'pro' | 'studio';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface PluginError extends Error {
  /** Machine-readable code, e.g. 'PERMISSION_DENIED'. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Whether the request can be retried. */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// stream — video and audio
// ---------------------------------------------------------------------------

export interface VideoFrame {
  /** RGBA/BGRA pixels, size = width * height * 4. */
  data: Uint8Array;
  width: number;
  height: number;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Whether the page background is transparent. */
  hasAlpha: boolean;
  /** Monotonically increasing frame number from 0. */
  sequenceNumber: number;
}

export interface AudioBuffer {
  /** PCM samples, interleaved if stereo. */
  data: Float32Array;
  /** Always 48000 Hz. */
  sampleRate: number;
  /** 1 (mono) or 2 (stereo). */
  channels: number;
  timestamp: number;
  sequenceNumber: number;
}

export interface StreamSettings {
  width: number;
  height: number;
  /** Target FPS (the actual value may be lower). */
  fps: number;
  hasAlpha: boolean;
  audioEnabled: boolean;
  sampleRate: number;
  channels: number;
}

export interface StreamStatus {
  state: 'idle' | 'starting' | 'streaming' | 'error' | 'stopped';
  message?: string;
  fps?: number;
  droppedFrames?: number;
}

export interface StreamApi {
  /** Subscribe to video frames. A repeat call replaces the callback. Requires stream.video. */
  onFrame(cb: (frame: VideoFrame) => void): void;
  /** Subscribe to audio buffers (~100/s). Requires stream.audio. */
  onAudio(cb: (buffer: AudioBuffer) => void): void;
  /** Current stream settings. */
  getSettings(): Promise<StreamSettings>;
  /** The user changed the settings. */
  onSettingsChange(cb: (settings: StreamSettings) => void): void;
  /** Report the plugin's state to the browser for the UI. */
  setStatus(status: StreamStatus): void;
}

// ---------------------------------------------------------------------------
// page — page interaction
// ---------------------------------------------------------------------------

export interface NavigationEvent {
  url: string;
  previousUrl: string | null;
  reason: 'user' | 'redirect' | 'reload';
}

export interface PageElement {
  selector: string;
  tagName: string;
  ariaLabel: string | null;
  dataAttributes: Record<string, string>;
  textContent: string | null;
  boundingRect: { x: number; y: number; width: number; height: number };
}

export type PageAction =
  | { type: 'click' }
  | { type: 'input'; value: string }
  | { type: 'drag'; deltaX: number; deltaY: number }
  | { type: 'script'; code: string };

export interface PageApi {
  /**
   * Tab URL. Requires page.read. Pass a `tabId` (from `bb.tabs.list()`) to target
   * a specific tab; omit to use the active tab of the focused window.
   */
  getURL(tabId?: number): Promise<string>;
  /** Navigation event. Requires page.read. */
  onNavigate(cb: (event: NavigationEvent) => void): void;
  /** Find an element in the target tab (active tab if `tabId` omitted). Requires page.interact. */
  querySelector(selector: string, tabId?: number): Promise<PageElement | null>;
  /** All matching elements (max 50). Requires page.interact. */
  querySelectorAll(selector: string, tabId?: number): Promise<PageElement[]>;
  /**
   * Action on an element in the target tab (active tab if `tabId` omitted).
   * Requires page.interact (script also needs page.script).
   */
  dispatchAction(selector: string, action: PageAction, tabId?: number): Promise<void>;
  /**
   * Interactive element picker: highlights elements under the cursor in the
   * target tab and resolves with the clicked element (including a robust
   * `selector` for later use), or null if cancelled (Escape) or timed out.
   * Requires page.interact.
   */
  pickElement(tabId?: number): Promise<PageElement | null>;
}

// ---------------------------------------------------------------------------
// storage — plugin storage (automatic per-plugin namespace)
// ---------------------------------------------------------------------------

export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// license — user plan
// ---------------------------------------------------------------------------

export interface LicenseApi {
  /** Returns the plan. Requires license. */
  getPlan(): Promise<Plan>;
  /** Plan-change event while the app is open. */
  onPlanChange(cb: (plan: Plan) => void): void;
}

// ---------------------------------------------------------------------------
// tabs — browser tabs
// ---------------------------------------------------------------------------

export interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  favicon: string | null;
  active: boolean;
}

export interface TabsApi {
  /** List all open tabs. Requires tabs.read. */
  list(): Promise<TabInfo[]>;
  /** Called when tabs change (opened, closed, title/URL updated). Requires tabs.read. */
  onChanged(cb: (tabs: TabInfo[]) => void): void;
}

// ---------------------------------------------------------------------------
// ui — control panel (isolated iframe)
// ---------------------------------------------------------------------------

export interface UiApi {
  /** Panel HTML. Requires ui.panel. */
  setPanel(html: string): void;
  /** Full-page HTML served at bb://page/<pluginId>, openable in a tab. Requires ui.page. */
  setPage(html: string): void;
  /** Messages from the HTML panel. */
  onMessage(cb: (message: unknown) => void): void;
  /** Send a message to the panel. */
  sendMessage(message: unknown): void;
  /**
   * Show a transient message in the browser's status bar (bottom-right corner),
   * e.g. to surface incoming activity. Auto-hides after `durationMs` (default
   * 5000). `color` is an optional CSS color for a leading dot/label.
   */
  notify(text: string, options?: { color?: string; durationMs?: number }): void;
}

// ---------------------------------------------------------------------------
// osc — OSC/UDP
// ---------------------------------------------------------------------------

export type OSCArg =
  | { type: 'f'; value: number }
  | { type: 'i'; value: number }
  | { type: 's'; value: string }
  | { type: 'b'; value: boolean };

export interface OSCMessage {
  address: string;
  args: OSCArg[];
  /**
   * The endpoint the message arrived on. Matches the `channel` passed to
   * `configure`. Omitted for the default (single-endpoint) channel — a plugin
   * that never uses channels can ignore this field.
   */
  channel?: string;
}

export interface OSCConfig {
  port: number;
  host?: string;
  sendPort?: number;
  /**
   * Endpoint id, for plugins that listen on several ports at once (e.g. one
   * port per timer instance). Each distinct `channel` gets its own UDP socket;
   * reconfiguring the same channel rebinds it. Omit for a single endpoint.
   */
  channel?: string;
}

export interface OscApi {
  /**
   * Configure a listen/send endpoint. Requires network.local. Pass
   * `config.channel` to open several endpoints from one plugin; omit it for a
   * single default endpoint. Reconfiguring the same channel rebinds its socket.
   */
  configure(config: OSCConfig): Promise<void>;
  /**
   * Incoming OSC (from every channel). Requires network.local. Use
   * `message.channel` to tell which endpoint a message arrived on.
   */
  onMessage(cb: (message: OSCMessage) => void): void;
  /**
   * Outgoing OSC on `channel` (default endpoint if omitted). Requires
   * network.local + that channel configured with host/sendPort.
   */
  send(address: string, args: OSCArg[], channel?: string): Promise<void>;
  /**
   * Send a one-off OSC message to an explicit `host:port`, independent of any
   * configured channel — fire-and-forget over a shared send socket. Use this to
   * target arbitrary destinations (e.g. per-cue triggers) without binding a
   * listen port. Requires network.local.
   */
  sendTo(address: string, args: OSCArg[], host: string, port: number): Promise<void>;
  /**
   * Release a channel's socket (frees its port). Omit `channel` for the default
   * endpoint. Requires network.local.
   */
  unbind(channel?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// The global bb object
// ---------------------------------------------------------------------------

export interface BB {
  readonly stream: StreamApi;
  readonly page: PageApi;
  readonly tabs: TabsApi;
  readonly storage: StorageApi;
  readonly license: LicenseApi;
  readonly ui: UiApi;
  readonly osc: OscApi;
  /** Plugin logging (goes to the browser log with the plugin namespace). */
  readonly log: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void;
  /**
   * Graceful-shutdown hook: called before the plugin is stopped so it can
   * release resources (e.g. the NDI sender). Native resources must not be
   * released during an unfinished send — wait for it inside the callback.
   */
  readonly onStop: (cb: () => void | Promise<void>) => void;
}

// ---------------------------------------------------------------------------
// Plugin manifest (manifest.json)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Minimum browser version (semver). */
  min_browser: string;
  /** Entry point, usually 'index.js'. */
  entry: string;
  permissions: Permission[];
  description?: string;
  /** Short icon string shown in toolbar (emoji or text, max ~4 chars). */
  icon?: string;
  author?: string;
  homepage?: string;
  required_plan?: Plan;
  /** Smoke test file relative to plugin dir (default: 'smoke.js'). */
  smoke?: string;
  // System fields (filled in at signing time):
  signature?: string;
  signed_at?: string;
  publisher?: string;
}

/** Plugin entry point: the browser calls it, passing bb. */
export type PluginEntry = (bb: BB) => void | Promise<void>;
