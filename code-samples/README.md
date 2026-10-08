# Code samples

These files are copied verbatim from the private BroadcastBrowser repository to
illustrate code style and the plugin model. They are excerpts, not a buildable
project.

## `plugin-api-contract.ts`

The complete typed surface a plugin sees through the global `bb` object —
streaming, OSC, storage, UI panels/pages, tabs, licensing, permissions. The
browser exposes nothing to plugins beyond this contract.

## `example-plugin/`

The full **Test Pattern** plugin — about 85 lines plus its manifest. A good
end-to-end example of how small a real plugin is:

- `manifest.json` — id, version, declared permissions, signature.
- `index.ts` — the entire plugin: it serves a page and a control panel, tracks
  which pattern tab is active, relays the panel's live edits to that tab, and
  remembers the last settings as the default for a new one. All host interaction
  goes through the `bb` API.

The pattern is drawn entirely by the plugin's own page from URL parameters; the
worker just coordinates. This is representative of the architecture: the host
stays generic, the plugin owns its domain logic.
