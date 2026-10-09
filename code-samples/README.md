# Code samples

Files copied verbatim from the private BroadcastBrowser repository to illustrate
code style and the kind of problems the project solves. They are excerpts (their
imports won't resolve here), not a buildable project.

## `plugin-api-contract.ts`

The complete typed surface a plugin sees through the global `bb` object —
streaming, OSC, storage, UI panels/pages, tabs, licensing, permissions. The
browser exposes nothing to plugins beyond this contract.

## `plugin-signature.ts`

The plugin integrity module: Ed25519 signing/verification of a plugin bundle
plus an optional sha256 checksum, as a pure `node:crypto` module (unit-tested in
isolation). This is what backs the "only first-party signed plugins load" claim.

## `osc-transport.ts`

The multi-channel OSC transport: per-plugin UDP endpoints keyed by
`(pluginId, channel)`, so one plugin can listen on several ports at once (e.g.
one port per timer instance), with incoming bundles flattened and routed into
the owning plugin's worker. Generic — it knows nothing about any specific plugin.

## `stream-manager.ts`

The real-time capture loop. Primary path uses `beginFrameSubscription` (a frame
per compositor paint, ~60 fps); a watchdog falls back to `capturePage()` when the
compositor stops painting (static or backgrounded tab) so the stream never
freezes. The doc comment explains the frame-rate trade-offs behind the design.

## `example-plugin/`

The full **Test Pattern** plugin — about 85 lines plus its manifest — showing how
small a real plugin is and how all host interaction goes through the `bb` API.
