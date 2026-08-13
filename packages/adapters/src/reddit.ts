/**
 * Reddit adapter.
 *
 * Easier than LinkedIn in every respect, and it inverts several of LinkedIn's
 * assumptions:
 *
 *   - `t3_...` fullnames are public, permanent and identical for every viewer,
 *     so crowd tagging genuinely accumulates here.
 *   - Because everyone sees the same objects, consensus is actually reachable,
 *     and a hide threshold of 1 would hand a single user far too much reach.
 *     Hence postHideThreshold 3 rather than LinkedIn's 1.
 *   - The slop is different slop. Nobody writes broetry on Reddit; the problem
 *     is generated comments, karma-farmed reposts and AI art bleeding into
 *     general subs. Only ai-image / ai-video / ai-text carry over.
 *
 * Two DOMs, both stable, handled as branches of one adapter rather than two
 * adapters: new Reddit is web components with everything on the light-DOM host,
 * and old.reddit is server-rendered HTML that has not meaningfully changed in a
 * decade. A meaningful slice of "the feed is poison" users are already on
 * old.reddit, so it is not an afterthought.
 */

import { DEFAULT_POLICY, type AdapterPolicy, type MediaRef } from '@sloppy/core';
import {
  SelectorChain,
  chainDiagnostics,
  readableText,
  type AuthorRef,
  type SiteAdapter,
} from './adapter.ts';

const feedChain = new SelectorChain('feed', [
  'shreddit-feed',
  '#siteTable', // old.reddit
  'main',
  'body',
]);

const postChain = new SelectorChain('post', [
  'shreddit-post',
  'div.thing[data-fullname^="t3_"]', // old.reddit
]);

const CHAINS = [feedChain, postChain];

function isOld(el: Element): boolean {
  return el.tagName.toLowerCase() !== 'shreddit-post';
}

function isFeedUrl(url: URL): boolean {
  return /(^|\.)reddit\.com$/.test(url.hostname);
}

function feedRoot(): Element | null {
  return feedChain.first(document);
}

function posts(root: Element): Element[] {
  return postChain.all(root);
}

/**
 * Reddit has no reshare nesting, so this is always a single id - but the
 * interface returns an array because LinkedIn needs one, and a per-site
 * signature would push a branch back up into shared code.
 */
function postIds(el: Element): string[] {
  const id = isOld(el) ? el.getAttribute('data-fullname') : el.getAttribute('id');
  return id && id.startsWith('t3_') ? [id] : [];
}

/** No vanity-slug problem here: usernames are immutable and sit on the host. */
function author(el: Element): AuthorRef {
  const name = (isOld(el) ? el.getAttribute('data-author') : el.getAttribute('author'))?.trim();
  if (!name || name === '[deleted]') return { id: null, kind: 'unknown' };
  return { id: `rd:u:${name}`, kind: 'person', vanity: name };
}

/**
 * Title plus body. A link post has no body at all, and on Reddit the title is
 * usually where the slop lives - scoring the body alone would score nothing.
 */
function text(el: Element): string {
  if (isOld(el)) {
    const title = readableText(el.querySelector('a.title'));
    const body = readableText(el.querySelector('.usertext-body'));
    return [title, body].filter(Boolean).join('\n\n');
  }
  const title = el.getAttribute('post-title')?.trim() ?? '';
  const body = readableText(el.querySelector('[slot="text-body"]'));
  return [title, body].filter(Boolean).join('\n\n');
}

/**
 * `post-type` plus `content-href` gives a clean media signal without touching
 * the subtree at all. Reddit surfaces no C2PA badge, so the metadata shortcut
 * that works on LinkedIn is unavailable - image slop here is human-tagged only.
 */
function media(el: Element): MediaRef[] {
  if (isOld(el)) {
    const domain = el.getAttribute('data-domain') ?? '';
    const href = el.getAttribute('data-url') ?? undefined;
    if (domain.includes('i.redd.it') || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(href ?? '')) {
      return [{ kind: 'image', src: href }];
    }
    if (domain.includes('v.redd.it')) return [{ kind: 'video', src: href }];
    return [];
  }

  const type = el.getAttribute('post-type');
  const href = el.getAttribute('content-href') ?? undefined;
  if (type === 'image') return [{ kind: 'image', src: href }];
  if (type === 'video') return [{ kind: 'video', src: href }];
  if (type === 'link') return [{ kind: 'link', src: href }];
  return [];
}

export const redditAdapter: SiteAdapter = {
  id: 'reddit',
  matches: ['*://*.reddit.com/*'],
  policy: { ...DEFAULT_POLICY, postHideThreshold: 3 } satisfies AdapterPolicy,
  isFeedUrl,
  feedRoot,
  posts,
  identityAttributes: ['id', 'data-fullname'],
  postIds,
  author,
  text,
  media,
  mountPoint: (el) => el,
  collapseTarget: (el) => el,
  diagnostics: () => chainDiagnostics(CHAINS),
};
