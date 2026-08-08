/**
 * LinkedIn adapter.
 *
 * VERIFY EVERY SELECTOR IN DEVTOOLS BEFORE TRUSTING IT. LinkedIn A/B-tests its
 * markup, so two people on the same day get different DOM, and its class names
 * are compiler-generated and rotate. Everything below is an ordered hypothesis
 * with a fallback, and `diagnostics()` reports which branch actually answered
 * so a breakage surfaces as a bug report instead of a silent uninstall.
 *
 * The SDUI rewrite moved LinkedIn onto semantic attributes, which is the only
 * reason this adapter is viable. Anchor on those; never on a class name alone.
 */

import { DEFAULT_POLICY, type AdapterPolicy, type AuthorKind, type MediaRef } from '@sloppy/core';
import {
  SelectorChain,
  chainDiagnostics,
  numAttr,
  readableText,
  type AuthorRef,
  type SiteAdapter,
} from './adapter.ts';

const ACTIVITY_PREFIX = 'urn:li:activity:';

const feedChain = new SelectorChain('feed', [
  '[data-testid="mainFeed"]',
  'main .scaffold-finite-scroll__content',
  'main[role="main"]',
  'main',
]);

const postChain = new SelectorChain('post', [
  `[data-urn^="${ACTIVITY_PREFIX}"]`,
  `[data-id^="${ACTIVITY_PREFIX}"]`,
  '.feed-shared-update-v2',
]);

const actorChain = new SelectorChain('actor', [
  '.update-components-actor',
  '[data-testid*="actor"]',
  '.feed-shared-actor',
]);

const textChain = new SelectorChain('text', [
  '.update-components-text',
  '.feed-shared-inline-show-more-text',
  '.feed-shared-update-v2__description',
  '[data-testid*="post-text"]',
]);

const mediaChain = new SelectorChain('media', [
  '.update-components-image, .update-components-linkedin-video',
  '.feed-shared-image, .feed-shared-linkedin-video',
]);

const CHAINS = [feedChain, postChain, actorChain, textChain, mediaChain];

/**
 * Content Credentials marker. LinkedIn renders one on C2PA-signed media, and
 * its presence is a near-certain generated-media flag at zero inference cost -
 * but it is one input to the score, never a hide on its own.
 */
const C2PA_SELECTORS = [
  '[data-testid*="content-credentials" i]',
  '[class*="content-credentials" i]',
  '[aria-label*="Content Credentials" i]',
  '[aria-label*="AI generated" i]',
  'button[title*="Content Credentials" i]',
];

function hasC2PABadge(scope: Element): boolean {
  return C2PA_SELECTORS.some((s) => {
    try {
      return scope.querySelector(s) !== null;
    } catch {
      return false;
    }
  });
}

function isFeedUrl(url: URL): boolean {
  if (!/(^|\.)linkedin\.com$/.test(url.hostname)) return false;
  const p = url.pathname;
  // Main feed, plus the permalink surface the same post component renders on.
  return p === '/' || p.startsWith('/feed');
}

function feedRoot(): Element | null {
  return feedChain.first(document);
}

function posts(root: Element): Element[] {
  return postChain.all(root);
}

/**
 * Both the outer post and, for a reshare-with-commentary, the original nested
 * inside it. A hit on either collapses, or the same slop walks past every time
 * somebody amplifies it.
 */
function postIds(el: Element): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v && v.startsWith(ACTIVITY_PREFIX) && !out.includes(v)) out.push(v);
  };

  push(el.getAttribute('data-urn'));
  push(el.getAttribute('data-id'));
  for (const n of el.querySelectorAll(`[data-urn^="${ACTIVITY_PREFIX}"], [data-id^="${ACTIVITY_PREFIX}"]`)) {
    push(n.getAttribute('data-urn'));
    push(n.getAttribute('data-id'));
  }
  return out;
}

const MEMBER_URN = /urn:li:(member|fsd_profile|organization|company):[A-Za-z0-9_-]+/;

/**
 * Prefer a member/company URN wherever one is exposed.
 *
 * Vanity slugs are user-mutable: rename yourself and you slip your own author
 * block. Both are returned so history can be migrated if a URN turns up on a
 * surface that does not expose one today.
 */
function author(el: Element): AuthorRef {
  const actor = actorChain.first(el) ?? el;

  // The actor block often carries the URN on itself, and querySelectorAll only
  // walks descendants - so search the element and its subtree, not the subtree.
  for (const n of [actor, ...actor.querySelectorAll('[data-urn], [data-id]')]) {
    const hay = `${n.getAttribute('data-urn') ?? ''} ${n.getAttribute('data-id') ?? ''}`;
    const m = MEMBER_URN.exec(hay);
    if (m) return { id: m[0], kind: kindFromUrn(m[0]), vanity: vanityOf(actor) };
  }

  const vanity = vanityOf(actor);
  if (!vanity) return { id: null, kind: 'unknown', vanity: null };
  return { id: vanity, kind: vanity.startsWith('li:company:') ? 'org' : 'person', vanity };
}

function kindFromUrn(urn: string): AuthorKind {
  return /organization|company/.test(urn) ? 'org' : 'person';
}

function vanityOf(actor: Element): string | null {
  const link = actor.querySelector<HTMLAnchorElement>('a[href*="/in/"], a[href*="/company/"]');
  const href = link?.getAttribute('href');
  if (!href) return null;
  const person = /\/in\/([^/?#]+)/.exec(href);
  if (person?.[1]) return `li:in:${decodeURIComponent(person[1])}`;
  const org = /\/company\/([^/?#]+)/.exec(href);
  if (org?.[1]) return `li:company:${decodeURIComponent(org[1])}`;
  return null;
}

function text(el: Element): string {
  return readableText(textChain.first(el));
}

/**
 * Attribute first, then the decoded intrinsic size. `naturalWidth` is 0 before
 * the image decodes and absent entirely outside a browser, so it is a fallback
 * rather than the source of truth.
 */
function imgDim(img: Element, attr: string, natural: 'naturalWidth' | 'naturalHeight'): number | undefined {
  const fromAttr = numAttr(img, attr);
  if (fromAttr !== undefined) return fromAttr;
  const n = (img as Partial<HTMLImageElement>)[natural];
  return typeof n === 'number' && n > 0 ? n : undefined;
}

function media(el: Element): MediaRef[] {
  const out: MediaRef[] = [];
  for (const container of mediaChain.all(el)) {
    const badge = hasC2PABadge(container);
    const img = container.querySelector('img');
    if (img) {
      out.push({
        kind: 'image',
        w: imgDim(img, 'width', 'naturalWidth'),
        h: imgDim(img, 'height', 'naturalHeight'),
        hasC2PABadge: badge,
        src: img.getAttribute('src') ?? undefined,
      });
      continue;
    }
    if (container.querySelector('video')) {
      out.push({ kind: 'video', hasC2PABadge: badge });
    }
  }
  return out;
}

function mountPoint(el: Element): Element {
  return el;
}

function collapseTarget(el: Element): Element {
  return el;
}

export const linkedinAdapter: SiteAdapter = {
  id: 'linkedin',
  matches: ['*://*.linkedin.com/*'],
  /**
   * A personalised feed means low overlap between any two users, so waiting for
   * consensus means the post has decayed before the threshold is met. One tag
   * propagates. The 2-reporter rule applies to *author* promotion, not to
   * individual post hides.
   */
  policy: { ...DEFAULT_POLICY, postHideThreshold: 1 } satisfies AdapterPolicy,
  isFeedUrl,
  feedRoot,
  posts,
  identityAttributes: ['data-urn', 'data-id'],
  postIds,
  author,
  text,
  media,
  mountPoint,
  collapseTarget,
  diagnostics: () => chainDiagnostics(CHAINS),
};
