/**
 * The SiteAdapter interface, and the small amount of machinery every adapter
 * shares.
 *
 * This is the seam that makes "add Reddit" mean "write one file". If you ever
 * find yourself writing `if (site === 'linkedin')` in core or in the extension's
 * shared UI, the interface is missing a method - fix it here rather than
 * branching there.
 */

import type { AdapterPolicy, AuthorKind, MediaRef, PostFeatures, SiteId } from '@sloppy/core';

export interface AuthorRef {
  /**
   * Stable id if the page exposes one, otherwise a vanity-derived fallback.
   * Vanity slugs are user-mutable, so an author who renames would otherwise
   * slip their own block.
   */
  id: string | null;
  kind: AuthorKind;
  /** Kept alongside `id` so history can be migrated if a URN turns up later. */
  vanity?: string | null;
}

export interface SiteAdapter {
  readonly id: SiteId;
  /** Host patterns, for the WXT content-script registration. */
  readonly matches: string[];
  readonly policy: AdapterPolicy;

  /** Cheap pre-check so we do not observe a profile page as if it were a feed. */
  isFeedUrl(url: URL): boolean;

  /** Observer scope. Never document.body - that is a whole-page mutation firehose. */
  feedRoot(): Element | null;
  posts(root: Element): Iterable<Element>;

  /**
   * The attributes that carry post identity.
   *
   * The MutationObserver has to watch these, not just childList. When a
   * virtualised feed recycles a node it often does so by REWRITING the id
   * attribute on an element it is already reusing - no node is added or
   * removed, so a childList-only observer never fires and the recycled element
   * keeps showing the previous post's verdict.
   */
  readonly identityAttributes: readonly string[];

  /**
   * Canonical id first, then any nested reshare originals.
   *
   * MUST be called at click time, never cached against a node: both feeds
   * virtualise and recycle DOM elements, so the element tagged thirty seconds
   * ago may be a different post now.
   */
  postIds(el: Element): string[];

  author(el: Element): AuthorRef;
  text(el: Element): string;
  media(el: Element): MediaRef[];

  /** Where the closed shadow host attaches. */
  mountPoint(el: Element): Element;
  /** What gets hidden and replaced by the stub. */
  collapseTarget(el: Element): Element;

  /** Which selector branch answered last, surfaced by the popup health check. */
  diagnostics(): Record<string, string>;
}

// ---------------------------------------------------------------------------
// Selector chains
// ---------------------------------------------------------------------------

/**
 * Every selector in this codebase is a hypothesis.
 *
 * LinkedIn A/B-tests its markup, so two users on the same day get different
 * DOM, and its class names are compiler-generated and rotate. An adapter is
 * therefore an ordered list of candidates where the first one that returns
 * nodes wins, and which one won is recorded so a breakage shows up as a bug
 * report rather than an uninstall.
 */
export class SelectorChain {
  readonly name: string;
  private readonly selectors: readonly string[];
  private used: string | null = null;

  constructor(name: string, selectors: readonly string[]) {
    this.name = name;
    this.selectors = selectors;
  }

  first(root: ParentNode): Element | null {
    for (const sel of this.selectors) {
      const el = root.querySelector(sel);
      if (el) {
        this.used = sel;
        return el;
      }
    }
    return null;
  }

  all(root: ParentNode): Element[] {
    for (const sel of this.selectors) {
      const els = [...root.querySelectorAll(sel)];
      if (els.length > 0) {
        this.used = sel;
        return els;
      }
    }
    return [];
  }

  /** null until something matched; that distinction is the health signal. */
  lastUsed(): string | null {
    return this.used;
  }
}

export function chainDiagnostics(chains: readonly SelectorChain[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of chains) out[c.name] = c.lastUsed() ?? 'no match';
  return out;
}

// ---------------------------------------------------------------------------
// Shared derivations
// ---------------------------------------------------------------------------

/**
 * Everything the adapters have in common, per the interface test in the plan:
 * if this function ever needs a site branch, the abstraction has sprung a leak.
 */
export function featuresFrom(adapter: SiteAdapter, el: Element): PostFeatures {
  const author = adapter.author(el);
  return {
    site: adapter.id,
    postIds: adapter.postIds(el),
    authorId: author.id,
    authorKind: author.kind,
    text: adapter.text(el),
    media: adapter.media(el),
  };
}

/** Numeric attribute if present and sane, otherwise undefined. */
export function numAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Text content with the "see more" affordance removed.
 *
 * On LinkedIn the ellipsis is CSS clamping, not truncation - the full body is
 * already in the DOM - so reading textContent is correct and clicking the
 * expander is both unnecessary and a way to get noticed.
 */
export function readableText(el: Element | null): string {
  if (!el) return '';
  const raw = el.textContent ?? '';
  return raw
    // The ellipsis is required, so a post that legitimately ends "...to see
    // more" keeps its own words. An earlier version matched a bare "see more"
    // preceded by any 1-3 dots, which quietly ate the sentence's full stop.
    .replace(/(?:…|\.{3})\s*(?:see\s+)?more\s*$/i, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
