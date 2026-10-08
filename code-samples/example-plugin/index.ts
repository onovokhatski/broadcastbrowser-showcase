import type { BB } from '../../src/plugin-api/contract';
import { PAGE_HTML } from './page-html.gen';
import { PANEL_HTML } from './panel/panel';
import {
  DEFAULT_PARAMS, nextNumericId, parseId, parsePageUrl, sanitizeParams, type PatternParams,
} from './shared/params';

const STORE_KEY = 'panel';

/**
 * Test-pattern plugin. The pattern itself is drawn entirely by the page from
 * its URL (bb://page/test-pattern?id=&w=&h=&p=&fit=). The worker serves the
 * page/panel HTML, tells the panel which pattern tab (if any) is active, relays
 * the panel's live edits to that tab, and remembers the last settings as the
 * default for a new tab.
 *
 * Live edits go out as { type: 'state', instanceId, params }: that shape is what
 * the page server caches and streams (SSE) to pages opened from outside, so
 * the same message reaches in-app tabs and web clients with that id. Tabs
 * announce their settings on load ('hello') and the worker re-broadcasts them
 * as state, so the server can serve a bare `?id=` web link with full settings.
 */
const entry = async (bb: BB): Promise<void> => {
  let last: PatternParams = sanitizeParams((await bb.storage.get(STORE_KEY)) ?? DEFAULT_PARAMS);

  const remember = (p: PatternParams): void => {
    last = p;
    void bb.storage.set(STORE_KEY, p);
  };

  /** The active tab, if it's one of our pattern tabs with an id. */
  const activeTarget = async (): Promise<{ id: string; params: PatternParams } | null> => {
    // Single-window assumption: with several windows the first active pattern tab wins.
    const tabs = await bb.tabs.list();
    for (const t of tabs) {
      if (!t.active) continue;
      const parsed = parsePageUrl(t.url);
      if (parsed?.id) return { id: parsed.id, params: parsed.params };
    }
    return null;
  };

  /** Latest settings per tab id (in-app tabs and edits) — for numbering. */
  const known = new Map<string, PatternParams>();

  const publish = (id: string, params: PatternParams): void => {
    known.set(id, params);
    bb.ui.sendMessage({ type: 'state', instanceId: id, params });
  };

  /** Next short id, past every open pattern tab and every id seen this session. */
  const nextId = async (): Promise<string> => {
    const used = new Set(known.keys());
    for (const t of await bb.tabs.list()) {
      const id = parsePageUrl(t.url)?.id;
      if (id) used.add(id);
    }
    return nextNumericId(used);
  };

  bb.ui.setPage(PAGE_HTML);
  bb.ui.setPanel(PANEL_HTML);

  bb.ui.onMessage((raw) => {
    const msg = raw as { type?: string; id?: string; params?: unknown } | null;
    if (msg?.type === 'ready') {
      void Promise.all([activeTarget(), nextId()]).then(([target, next]) => {
        bb.ui.sendMessage({ type: 'init', last, target, nextId: next });
      });
    } else if (msg?.type === 'hello') {
      // A tab (re)loaded: cache its settings on the page server for web links.
      const id = parseId(`?id=${encodeURIComponent(String(msg.id ?? ''))}`);
      if (id) publish(id, sanitizeParams(msg.params));
    } else if (msg?.type === 'apply' && typeof msg.id === 'string') {
      // Live edit of an open tab: broadcast; only pages with this id react.
      const params = sanitizeParams(msg.params);
      publish(msg.id, params);
      remember(params);
    } else if (msg?.type === 'save') {
      remember(sanitizeParams(msg.params));
    }
  });
};

export default entry;
