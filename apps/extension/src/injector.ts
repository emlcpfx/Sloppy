/**
 * The shared content-script engine: observe, inject, decide, render.
 *
 * Site-agnostic by construction - it is handed a SiteAdapter and never asks
 * which one it got.
 */

import { decide, fingerprint, type Prefs, type Ruleset, type SiteId, type Verdict } from '@sloppy/core';
import { featuresFrom, type SiteAdapter } from '@sloppy/adapters';
import { onStorageChanged, read, sendMessage, write } from './browser.ts';
import {
  KEYS,
  addLocalTag,
  bumpStat,
  loadLocalTags,
  loadPrefs,
  loadRuleset,
  loadSnapshot,
  mergeIndex,
  recordUnhide,
  saveHealth,
} from './state.ts';
import { createPostUI, type PostUI } from './ui/post-ui.ts';
import { injectPageStyles } from './ui/dom.ts';
import { PAGE_CSS } from './ui/styles.ts';

/** Posts the user pulled back out of a stub. Always shown, whatever the list says. */
const OVERRIDES_KEY = (site: SiteId) => `overrides:${site}`;

interface Tracked {
  ui: PostUI;
  /** The ids this element was last rendered FOR. */
  signature: string;
  verdict: Verdict;
}

interface Engine {
  prefs: Prefs;
  ruleset: Ruleset;
  index: Awaited<ReturnType<typeof buildIndex>>;
  overrides: Set<string>;
}

async function buildIndex(adapter: SiteAdapter) {
  const [snapshot, local] = await Promise.all([loadSnapshot(adapter.id), loadLocalTags(adapter.id)]);
  return mergeIndex(snapshot, local, adapter.policy.postHideThreshold);
}

async function loadEngine(adapter: SiteAdapter): Promise<Engine> {
  const [prefs, ruleset, index, overrides] = await Promise.all([
    loadPrefs(),
    loadRuleset(),
    buildIndex(adapter),
    read<string[]>('local', OVERRIDES_KEY(adapter.id), []),
  ]);
  return { prefs, ruleset, index, overrides: new Set(overrides) };
}

export function runAdapter(adapter: SiteAdapter): void {
  injectPageStyles(PAGE_CSS);

  const tracked = new Map<Element, Tracked>();
  let engine: Engine | null = null;
  let observer: MutationObserver | null = null;
  let root: Element | null = null;
  let scheduled = false;
  let acquireTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set when a feed URL has been open a while with nothing found. */
  let firstEmptyAt = 0;

  // -------------------------------------------------------------------------
  // Verdicts
  // -------------------------------------------------------------------------

  function verdictFor(el: Element): Verdict {
    if (!engine) return { action: 'show' };
    const features = featuresFrom(adapter, el);
    for (const id of features.postIds) {
      if (engine.overrides.has(id)) return { action: 'show' };
    }
    return decide(features, {
      index: engine.index,
      prefs: engine.prefs,
      policy: adapter.policy,
      ruleset: engine.ruleset,
    });
  }

  /**
   * Posts already counted as filtered, this page life.
   *
   * Without it the counter re-counts every collapsed post on every page load,
   * and again each time a virtualised node scrolls back into view - which turns
   * "posts filtered" into a number that mostly measures scrolling.
   */
  const counted = new Set<string>();

  function applyVerdict(el: Element, t: Tracked): void {
    const verdict = verdictFor(el);
    t.verdict = verdict;

    if (verdict.action === 'collapse') {
      const id = adapter.postIds(el)[0];
      if (id && !counted.has(id)) {
        counted.add(id);
        void bumpStat('collapsed');
      }
    }

    reassert(el, t);
    t.ui.render(verdict);
  }

  /**
   * Put the light-DOM state back, every sweep.
   *
   * A re-render does not only throw our host away - it throws our ATTRIBUTES
   * away, and those are what the collapse stylesheet keys off. Re-injecting the
   * button while leaving the post uncollapsed means a hidden post silently pops
   * back into the feed on the next render, which is the exact failure the whole
   * observer exists to prevent.
   *
   * Every write is guarded by a read first. Setting an attribute to the value it
   * already has still fires the MutationObserver, so an unconditional write here
   * would feed the observer that scheduled this sweep and spin forever.
   */
  function reassert(el: Element, t: Tracked): void {
    const target = adapter.collapseTarget(el);

    if (target.getAttribute('data-sloppy-post') !== '1') {
      target.setAttribute('data-sloppy-post', '1');
    }

    const collapsed = t.verdict.action === 'collapse';
    const has = target.getAttribute('data-sloppy-collapsed') === '1';
    if (collapsed && !has) target.setAttribute('data-sloppy-collapsed', '1');
    if (!collapsed && has) target.removeAttribute('data-sloppy-collapsed');
  }

  // -------------------------------------------------------------------------
  // Injection
  // -------------------------------------------------------------------------

  function attach(el: Element): Tracked {
    const ui = createPostUI(adapter.id, {
      /**
       * Ids are read HERE, not at injection time. Both feeds virtualise and
       * recycle DOM nodes, so the element tagged thirty seconds ago may be a
       * different post now - and tagging the wrong post is the one mistake a
       * crowd-sourced list cannot recover from.
       */
      async onTag(tag: string) {
        const ids = adapter.postIds(el);
        const postId = ids[0];
        if (!postId) return;

        const author = adapter.author(el);
        const text = adapter.text(el);

        await addLocalTag(adapter.id, { postId, authorId: author.id, tag, ts: Date.now() });
        await dropOverride(postId);

        // Fire-and-forget: a dropped tag must never surface an error mid-feed.
        void sendMessage({
          type: 'sloppy:tag',
          site: adapter.id,
          postId,
          authorId: author.id,
          authorKind: author.kind,
          tag,
          textHash: fingerprint(text),
        });

        await refreshEngine();
      },

      async onShow() {
        const ids = adapter.postIds(el);
        const t = tracked.get(el);
        const reason = t && t.verdict.action === 'collapse' ? t.verdict.reason : 'unknown';
        for (const id of ids) await addOverride(id, reason);
        await refreshEngine();
      },
    });

    adapter.collapseTarget(el).setAttribute('data-sloppy-post', '1');
    adapter.mountPoint(el).appendChild(ui.host);

    const t: Tracked = { ui, signature: signatureOf(el), verdict: { action: 'show' } };
    tracked.set(el, t);
    return t;
  }

  const signatureOf = (el: Element) => adapter.postIds(el).join('|');

  function sweep(): void {
    if (!root || !root.isConnected) {
      acquire();
      return;
    }

    let count = 0;
    for (const el of adapter.posts(root)) {
      count++;
      let t = tracked.get(el);

      if (!t) {
        t = attach(el);
        applyVerdict(el, t);
        continue;
      }

      // React reconciliation happily throws our host away. Put it back.
      if (!t.ui.host.isConnected || !el.contains(t.ui.host)) {
        adapter.mountPoint(el).appendChild(t.ui.host);
      }

      // Recycled node: same element, different post. Re-decide.
      const sig = signatureOf(el);
      if (sig !== t.signature) {
        t.signature = sig;
        t.ui.closePicker();
        applyVerdict(el, t);
      } else {
        // Same post, but the site may have re-rendered our attributes away.
        reassert(el, t);
      }
    }

    // Drop anything the feed has discarded, or the map grows without bound.
    for (const [el, t] of tracked) {
      if (!el.isConnected) {
        t.ui.destroy();
        tracked.delete(el);
      }
    }

    reportHealth(count);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    // Feeds mutate constantly; coalescing to a frame keeps this off the
    // critical path rather than re-running the sweep per mutation record.
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        sweep();
      } catch (err) {
        console.warn('[sloppy] sweep failed', err);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  function teardown(): void {
    observer?.disconnect();
    observer = null;
    for (const [, t] of tracked) t.ui.destroy();
    tracked.clear();
    root = null;
  }

  /**
   * Find the feed and observe it.
   *
   * Scoped to the feed container, never document.body - observing the body on
   * LinkedIn is a whole-page mutation firehose, and the callback would run
   * hundreds of times a second for chrome that has nothing to do with posts.
   */
  function acquire(): void {
    if (acquireTimer) clearTimeout(acquireTimer);

    if (!adapter.isFeedUrl(new URL(location.href))) {
      teardown();
      return;
    }

    const found = adapter.feedRoot();
    if (!found) {
      firstEmptyAt ||= Date.now();
      reportHealth(0);
      // The feed is client-rendered; it may simply not exist yet.
      acquireTimer = setTimeout(acquire, 800);
      return;
    }

    if (found === root && observer) {
      schedule();
      return;
    }

    teardown();
    root = found;
    observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      // Recycling often rewrites the id in place without touching the tree, so
      // childList alone misses it. Filtered to identity attributes only - our
      // own data-sloppy-* writes are excluded and cannot feed the observer that
      // scheduled the sweep making them.
      attributes: true,
      attributeFilter: [...adapter.identityAttributes],
    });
    schedule();
  }

  // -------------------------------------------------------------------------
  // SPA navigation
  // -------------------------------------------------------------------------

  /**
   * LinkedIn is client-side routed and swaps the feed container wholesale on
   * navigation. `popstate` does NOT fire for pushState, so patching history is
   * not optional - and the poll is the belt to that pair of braces, because a
   * framework can also replace the container without any history change at all.
   */
  function watchNavigation(): void {
    let lastUrl = location.href;

    const onNav = () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      teardown();
      acquire();
    };

    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name];
      history[name] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const result = original.apply(this, args);
        queueMicrotask(onNav);
        return result;
      } as History[typeof name];
    }

    window.addEventListener('popstate', onNav);
    setInterval(onNav, 1000);

    /**
     * LinkedIn refetches and re-renders the feed when a backgrounded tab comes
     * forward, which replaces the container we were observing.
     */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') acquire();
    });
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /**
   * A silent breakage is an uninstall; a reported one is a bug report.
   *
   * If a feed URL has been open for a few seconds and the adapter is still
   * finding nothing, that is recorded and the popup says "markup changed -
   * update pending" instead of the extension simply appearing to do nothing.
   */
  let lastHealthAt = 0;
  function reportHealth(postCount: number): void {
    const now = Date.now();
    if (postCount > 0) firstEmptyAt = 0;
    else firstEmptyAt ||= now;

    if (now - lastHealthAt < 4000) return;
    lastHealthAt = now;

    void saveHealth({
      site: adapter.id,
      checkedAt: now,
      feedFound: root !== null,
      postCount,
      diagnostics: adapter.diagnostics(),
    });
  }

  // -------------------------------------------------------------------------
  // Overrides + reactive state
  // -------------------------------------------------------------------------

  async function addOverride(id: string, reason: string): Promise<void> {
    const list = await read<string[]>('local', OVERRIDES_KEY(adapter.id), []);
    if (!list.includes(id)) {
      list.push(id);
      await write('local', OVERRIDES_KEY(adapter.id), list.slice(-2000));
    }
    await recordUnhide(adapter.id, id, reason);
  }

  async function dropOverride(id: string): Promise<void> {
    const list = await read<string[]>('local', OVERRIDES_KEY(adapter.id), []);
    if (!list.includes(id)) return;
    await write('local', OVERRIDES_KEY(adapter.id), list.filter((x) => x !== id));
  }

  async function refreshEngine(): Promise<void> {
    engine = await loadEngine(adapter);
    for (const [el, t] of tracked) {
      if (el.isConnected) applyVerdict(el, t);
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  void (async () => {
    engine = await loadEngine(adapter);
    watchNavigation();
    acquire();

    /**
     * Only reload for changes that can alter a verdict.
     *
     * `stats` and `negatives` are written BY this content script as a side
     * effect of collapsing, so reacting to them would have every tab reload its
     * whole engine and re-decide every post each time any tab hid anything.
     */
    const IGNORED = new Set<string>([KEYS.stats, KEYS.negatives, KEYS.queue]);

    onStorageChanged((changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      const keys = Object.keys(changes ?? {});
      if (keys.length > 0 && keys.every((k) => IGNORED.has(k))) return;
      void refreshEngine();
    });
  })();
}
