# Architecture

BroadcastBrowser is an Electron browser whose only job is to render web pages and
hand them to plugins. It contains no NDI/OSC/output code itself — that lives in
plugins that communicate through one typed API. This document describes how the
pieces fit together.

## Three processes

1. **Main** — the Electron main process. Owns windows, all IPC handlers, the
   `bb://` protocol, and the plugin lifecycle. Every privileged operation is
   gated here.
2. **Preload** — exposes a minimal, typed `window.bb` bridge to the renderer.
   Panel windows get a reduced bridge instead of the full browser API.
3. **Renderer** — the browser chrome (tabs, address bar, toolbar) in vanilla
   TypeScript, no framework. Internal pages (settings, history, downloads, new
   tab) are separate HTML documents served over `bb://`.

## Tabs

Tabs are `WebContentsView` instances managed by a `TabManager`, positioned below
the chrome. They render **above** the window's own web contents, so DOM overlays
cannot cover them — which is why plugin panels are child `BrowserWindow`s rather
than in-page iframes.

## Plugin system

```
PluginRegistry   install / uninstall / enable, verify Ed25519 signature
      |
PluginController one long-lived host per enabled plugin (lifecycle, panels)
      |
PluginHost       a Worker thread running the pre-bundled plugin runtime
      |
plugin-runtime   builds the `bb` object, then calls the plugin's entry()
```

- **PluginController** owns a plugin's host independent of whether it is
  streaming. It surfaces panel UI and relays messages.
- **StreamCoordinator** attaches video + audio capture to an already-running
  host on demand. It does not own the host — start/stop streaming never restarts
  the plugin.
- **StreamManager** captures frames from a real tab's `WebContents` via
  `capturePage()` on a timer. There is no separate offscreen window for the
  mirror path; the stream is exactly what the tab renders.

### Isolation and permissions

Each plugin runs in its own Worker thread, which keeps plugin work off the UI and
main event loop and gives it a clean API boundary. It is isolation, not a security
sandbox: a Worker has normal Node access, so the trust boundary for *running* code
is signing (below) — only first-party signed plugins load.

What the capability model constrains is the `bb` surface. A plugin declares the
capabilities it needs in its manifest (for example `stream.video`, `stream.audio`,
`network.local`, `storage`, `ui.panel`, `license`, `tabs.read`), and the host
gates the API to that grant twice: a fast reject inside the runtime and the
authoritative check in the main process, so a plugin cannot use a host capability
it did not request.

### Signing

Plugin bundles are signed with an Ed25519 private key held only by the publisher.
The app embeds the matching public key and, in production builds, verifies the
signature of a plugin's entry bundle before loading it. Unsigned or tampered
plugins are rejected. Plugins are distributed and installed separately from the
browser, keeping the host generic.

### Native modules

Plugins installed into the user data directory cannot resolve native Node addons
from there. The runtime exposes a controlled `require` seeded from the app's own
`node_modules`, so a plugin such as the NDI output can load its native
dependency without bundling platform binaries itself.

## Panels and pages (`bb://`)

A plugin can provide a **panel** (a small control surface) and/or a **page** (a
full renderable document, e.g. a timer display or a test pattern).

- `bb.ui.setPanel(html)` → the host wraps it and serves it at
  `bb://panel/<pluginId>`, opened in a frameless, parent-anchored child window.
- `bb.ui.setPage(html)` → served at `bb://page/<pluginId>` and openable as a
  normal tab, which is then what gets captured and streamed.

Panel/page and worker talk over `postMessage`/`onMessage`, bridged through the
preload layer. A live HTTP page server can also stream a plugin page's state to
external web clients over SSE, so an in-app tab and a browser on another machine
stay in sync.

## OSC transport

The host provides a multi-channel OSC layer: a plugin can configure one or more
channels, each bound to its own UDP port, and send and receive messages
independently. This is what lets a single timer plugin run several independent
timers, each with its own incoming and outgoing OSC.

## Security model

- All tab web contents run with `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`.
- A domain whitelist blocks navigation and server-side redirects to
  non-whitelisted hosts.
- Internal pages are served under a strict Content-Security-Policy.
- Plugin Worker threads are isolated and permission-checked as above.

## Build and delivery

- Production builds are produced by GitHub Actions on a tagged commit, as a
  matrix over macOS (Apple Silicon) and Windows.
- macOS: DMG + ZIP, ad-hoc signed so Gatekeeper does not flag the app as damaged
  (full Developer ID signing when credentials are supplied).
- Windows: a Squirrel installer (`Setup.exe`) with auto-update support.
- The browser and each plugin are versioned and released independently.
