# BroadcastBrowser

A desktop browser for live video production. It renders any web page and streams
it as a professional **NDI** video source (with alpha channel and audio) into
tools like OBS, vMix, Resolume and TouchDesigner — over the local network, with
no capture card.

The browser itself contains **no output logic**. Everything — NDI output, OSC
control, timers, test patterns — lives in **sandboxed, signed plugins** that
talk to the host only through a single typed API (`bb`). This repository is a
public showcase of the architecture and selected code; the full source is
private.

> **Status: work in progress.** The streaming engine and plugins are functional,
> but the interface, visual design and UX are still being actively developed.
> This is an early beta shown to illustrate the architecture and direction — not
> a finished product, and the UI does not yet reflect its final quality.
>
> Built with Electron + TypeScript. Signed macOS (Apple Silicon) and Windows
> builds are produced by CI — see [Download](#download).

## Download

Early beta builds (version 0.6.3):

- **macOS (Apple Silicon):** [`BroadcastBrowser-0.6.3-arm64.dmg`](https://github.com/onovokhatski/broadcastbrowser-showcase/releases/latest)
- **Windows:** [`BroadcastBrowser-Setup.exe`](https://github.com/onovokhatski/broadcastbrowser-showcase/releases/latest)

See the [latest release](https://github.com/onovokhatski/broadcastbrowser-showcase/releases/latest)
for both files and first-launch notes (the macOS build is ad-hoc signed, so the
first open needs System Settings → Privacy & Security → **Open Anyway**).

---

## Why it exists

Getting a web page into a video mixer normally means screen-capturing a browser
window — fixed resolution, no transparency, no clean audio, and whatever else is
on screen leaks in. BroadcastBrowser turns a tab into a first-class **NDI source**:
exact resolution, real alpha channel, synced audio, discoverable on the network.

## Context

A solo project, designed and built end to end — from the plugin architecture and
the native NDI path to cross-platform CI and signing. It started as a tool for my
own live-production work (driving shows with Resolume, TouchDesigner and QLab),
so every plugin comes from a concrete, recurring need rather than a feature list.

The point of the closed-plugin design is adaptability: a new requirement becomes a
small signed plugin against the stable `bb` API, not a fork of the browser. The
six plugins below were each built this way.

## Technical highlights

- **Closed plugin architecture.** The host knows nothing about NDI or OSC. Each
  plugin runs in its own isolated **Worker thread** and reaches the browser only
  through the typed `bb` API ([`code-samples/plugin-api-contract.ts`](code-samples/plugin-api-contract.ts)).
- **Signed plugins.** In production every plugin bundle is verified with an
  **Ed25519** signature against a public key embedded in the app. Only
  first-party, signed plugins load.
- **Capability-based permissions.** A plugin declares what it needs
  (`stream.video`, `network.local`, `storage`, `ui.panel`, …); the host enforces
  it — fast-reject in the runtime, authoritatively in the main process.
- **Real-tab capture.** Video frames come from the actual tab's `WebContents`, so
  the stream mirrors exactly what renders — including page transparency for alpha.
- **OSC integration.** A multi-channel OSC transport in the host lets plugins
  bind independent UDP ports for bidirectional show control (timers, triggers,
  faders, spreadsheet-driven values).
- **Cross-platform delivery.** GitHub Actions builds signed macOS (DMG) and
  Windows (Squirrel installer with auto-update) artifacts from one tagged commit.

## Screenshots

> Early beta — UI, visual design and UX are still being actively developed.

### The browser

**New-tab / home page** — search, bookmarks and frequently visited pages.

![New-tab home page](docs/screenshots/home.webp)

**Settings → Appearance** — built-in color themes (Dark, Light, Nord, Monokai).

![Settings — Appearance](docs/screenshots/appearance.webp)

**Settings → Plugins** — the signed first-party plugins, installed and toggled
independently of the browser.

![Settings — Plugins](docs/screenshots/plugins.webp)

### Plugins

**Test Pattern** — a 4K (3840×2160) alignment chart with a bouncing-ball motion
test, frame counter and a live performance overlay (render FPS, draw time,
dropped frames).

![Test Pattern plugin](docs/screenshots/test-pattern.webp)

**OSC Timer** — a stage/broadcast timer with a dial skin on a transparent
background (the checkerboard is the alpha channel), running several independent
timers, each on its own OSC port.

![OSC Timer plugin](docs/screenshots/osc-timer.webp)

**Voice Indicator** — an audio-level meter driven by the active tab's sound.

![Voice Indicator plugin](docs/screenshots/voice-indicator.webp)

**OSC Control** — maps incoming OSC to page elements: triggers (clicks) and
faders (input values), with learn/pick and saved presets.

![OSC Control plugin](docs/screenshots/osc-control.webp)

**Sheets to OSC** — rules mapping Google Sheet cells to OSC addresses
(service-account identifier redacted).

![Sheets to OSC plugin](docs/screenshots/sheets-osc.png)

## Architecture at a glance

```mermaid
flowchart TD
    subgraph Renderer["Renderer — browser chrome (vanilla TS)"]
        UI["Tabs, address bar, toolbar"]
    end
    subgraph Main["Main process (Electron)"]
        TM["TabManager (WebContentsView per tab)"]
        SM["StreamManager (capturePage on a timer)"]
        PR["PluginRegistry (install / enable / verify signature)"]
        PC["PluginController (one host per enabled plugin)"]
        SC["StreamCoordinator (attaches capture on demand)"]
    end
    subgraph Worker["Plugin — isolated Worker thread"]
        RT["plugin-runtime builds 'bb' -> plugin entry()"]
        NDI["e.g. NDI output via native module"]
    end

    UI <-->|IPC via preload| Main
    PR --> PC --> RT
    SC -->|video + audio frames| RT
    SM --> SC
    RT --> NDI
    NDI -->|NDI over network| Ext["OBS / vMix / Resolume / TouchDesigner"]
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Engineering highlights

A few of the harder problems behind it:

- **60 fps alpha capture, no capture card.** Frames come from the tab's
  compositor via `beginFrameSubscription` (a frame per paint); a watchdog falls
  back to `capturePage()` when painting stops (static or backgrounded tab) so the
  stream never freezes, and the tab keeps rendering off-screen. Physical vs
  logical frame size is reconciled so downstream tools get the true resolution.
  ([`stream-manager.ts`](code-samples/stream-manager.ts))
- **A closed, signed plugin system.** Each plugin bundle is verified with an
  Ed25519 signature against an embedded publisher key before it loads, with
  capability permissions enforced in both the worker and the main process.
  ([`plugin-signature.ts`](code-samples/plugin-signature.ts))
- **Multi-channel OSC.** One plugin can own several UDP endpoints at once, keyed
  by `(plugin, channel)` — e.g. a timer plugin running many independent timers,
  each on its own port, bidirectionally. ([`osc-transport.ts`](code-samples/osc-transport.ts))
- **Cross-platform native builds in CI.** The NDI native addon is rebuilt for
  macOS (Apple Silicon) and Windows on GitHub Actions. On the newest Windows
  runner image node-gyp couldn't detect Visual Studio; pinning the toolchain
  image fixed the build without vendoring the NDI SDK by hand.
- **Rendering in old embedded Chromium.** A timer skin used container-query units
  that TouchDesigner's older CEF renderer doesn't support, collapsing the layout;
  replacing them with a JS-computed sizing unit made overlays render identically
  in-app and inside the host.

## Plugin ecosystem

All plugins are first-party and signed. Users install them separately, so the
browser stays a thin, generic host.

| Plugin | What it does |
|---|---|
| **NDI** | Streams the tab as NDI video + audio, with alpha-channel support |
| **OSC Timer** | Stage / broadcast timer (count-up, countdown, external) driven over OSC, multiple independent instances |
| **OSC Control** | Maps incoming OSC to web-page elements — triggers (click) and faders (input value) |
| **Sheets to OSC** | Watches cells in a Google Sheet and sends changed values over OSC |
| **Test Pattern** | Color bars, geometry grid and motion patterns at a preset or custom size |
| **Voice Indicator** | Visual voice-activity meter from the active tab's audio |

## Tech stack

- **Electron** + **TypeScript** (strict), no renderer framework (vanilla TS)
- `WebContentsView` tabs rendered above the chrome
- Plugins in **Worker threads**; native NDI via a Node addon
- **Vite** build, **ESLint**, **Vitest** (unit tests for the OSC transport,
  parameter parsing, plugin registry, signature regression, and more)
- CI/CD on **GitHub Actions** (macOS arm64 + Windows), code-signing per platform

## Code samples

Representative source, copied verbatim from the private project, to show code
style and the problems it solves (see [`code-samples/`](code-samples/)):

- [`plugin-api-contract.ts`](code-samples/plugin-api-contract.ts) — the complete
  typed `bb` API surface a plugin sees.
- [`plugin-signature.ts`](code-samples/plugin-signature.ts) — Ed25519 plugin
  signing/verification, a pure `node:crypto` module.
- [`osc-transport.ts`](code-samples/osc-transport.ts) — the multi-channel UDP OSC
  transport (one plugin, many ports).
- [`stream-manager.ts`](code-samples/stream-manager.ts) — the real-time capture
  loop (frame subscription with a `capturePage` fallback).
- [`example-plugin/`](code-samples/example-plugin/) — the full Test Pattern
  plugin (≈85 lines) and its manifest.

Full source is available for review on request.

## License

All rights reserved. The code here is shown for review and portfolio purposes
only; it may not be reused or redistributed.
