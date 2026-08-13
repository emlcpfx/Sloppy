import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { featuresFrom } from './adapter.ts';
import { linkedinAdapter as li } from './linkedin.ts';

/** Install a parsed document as the global the adapter reads. */
function mount(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  (globalThis as { document?: unknown }).document = document;
  return document;
}

const POST = (urn: string, inner = '') => `
<div data-urn="${urn}" class="feed-shared-update-v2">
  <div class="update-components-actor">
    <a href="/in/some-person?trk=feed"><span>Some Person</span></a>
  </div>
  <div class="update-components-text">Shipped the lighting pass today. #vfx</div>
  ${inner}
</div>`;

test('finds the feed root and enumerates posts', () => {
  mount(`<main><div data-testid="mainFeed">${POST('urn:li:activity:1111111111111111111')}${POST('urn:li:activity:2222222222222222222')}</div></main>`);
  const root = li.feedRoot();
  assert.ok(root);
  assert.equal([...li.posts(root)].length, 2);
  assert.equal(li.diagnostics()['feed'], '[data-testid="mainFeed"]');
});

test('falls back down the selector chain when the primary attribute is gone', () => {
  // No data-testid, no data-urn: the shape LinkedIn serves some users.
  mount(`
    <main><div class="scaffold-finite-scroll__content">
      <div class="feed-shared-update-v2" data-id="urn:li:activity:3333333333333333333">
        <div class="update-components-text">body</div>
      </div>
    </div></main>`);
  const root = li.feedRoot();
  assert.ok(root);
  const found = [...li.posts(root)];
  assert.equal(found.length, 1);
  assert.deepEqual(li.postIds(found[0]!), ['urn:li:activity:3333333333333333333']);
  // The health check can see that a fallback answered, not the primary.
  assert.equal(li.diagnostics()['feed'], 'main .scaffold-finite-scroll__content');
});

test('a reshare returns the outer id AND the nested original', () => {
  const nested = `<div data-urn="urn:li:activity:9999999999999999999"><div class="update-components-text">original slop</div></div>`;
  mount(`<main><div data-testid="mainFeed">${POST('urn:li:activity:1111111111111111111', nested)}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.deepEqual(li.postIds(el), [
    'urn:li:activity:1111111111111111111',
    'urn:li:activity:9999999999999999999',
  ]);
});

test('ids are read fresh from the node, never cached', () => {
  mount(`<main><div data-testid="mainFeed">${POST('urn:li:activity:1111111111111111111')}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.deepEqual(li.postIds(el), ['urn:li:activity:1111111111111111111']);

  // Virtualisation recycles the node under us. Same element, different post.
  el.setAttribute('data-urn', 'urn:li:activity:4444444444444444444');
  assert.deepEqual(li.postIds(el), ['urn:li:activity:4444444444444444444']);
});

test('a member URN wins over the mutable vanity slug', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-urn="urn:li:activity:1111111111111111111">
      <div class="update-components-actor" data-urn="urn:li:member:12345">
        <a href="/in/renameable-person"><span>Person</span></a>
      </div>
    </div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  const a = li.author(el);
  assert.equal(a.id, 'urn:li:member:12345');
  assert.equal(a.kind, 'person');
  // Kept so history survives if the slug changes.
  assert.equal(a.vanity, 'li:in:renameable-person');
});

test('company posts are typed as org so they can carry a different threshold', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-urn="urn:li:activity:1111111111111111111">
      <div class="update-components-actor"><a href="/company/some-studio/">Studio</a></div>
    </div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.deepEqual(li.author(el), {
    id: 'li:company:some-studio',
    kind: 'org',
    vanity: 'li:company:some-studio',
  });
});

test('an unattributable post yields a null author rather than a guess', () => {
  mount(`<main><div data-testid="mainFeed"><div data-urn="urn:li:activity:1111111111111111111"></div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.equal(li.author(el).id, null);
});

test('"see more" is CSS clamping, so the full body is already readable', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-urn="urn:li:activity:1111111111111111111">
      <div class="update-components-text">The whole body is present in the DOM.…see more</div>
    </div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.equal(li.text(el), 'The whole body is present in the DOM.');
});

test('a post that really ends with the words "see more" keeps them', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-urn="urn:li:activity:1111111111111111111">
      <div class="update-components-text">Full gallery on the site if you want to see more</div>
    </div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.equal(li.text(el), 'Full gallery on the site if you want to see more');
});

test('the Content Credentials badge is picked up as a media signal', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-urn="urn:li:activity:1111111111111111111">
      <div class="update-components-image">
        <span aria-label="Content Credentials"></span>
        <img src="https://media.licdn.com/x.jpg" width="1024" height="1024">
      </div>
    </div></div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  const [m] = li.media(el);
  assert.equal(m?.kind, 'image');
  assert.equal(m?.hasC2PABadge, true);
  assert.equal(m?.w, 1024);
  assert.equal(m?.h, 1024);
});

test('only feed surfaces are observed', () => {
  assert.equal(li.isFeedUrl(new URL('https://www.linkedin.com/feed/')), true);
  assert.equal(li.isFeedUrl(new URL('https://www.linkedin.com/')), true);
  assert.equal(li.isFeedUrl(new URL('https://www.linkedin.com/feed/update/urn:li:activity:1/')), true);
  assert.equal(li.isFeedUrl(new URL('https://www.linkedin.com/messaging/')), false);
  assert.equal(li.isFeedUrl(new URL('https://example.com/feed/')), false);
});

test('featuresFrom produces the shape core expects', () => {
  mount(`<main><div data-testid="mainFeed">${POST('urn:li:activity:1111111111111111111')}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  const f = featuresFrom(li, el);
  assert.equal(f.site, 'linkedin');
  assert.deepEqual(f.postIds, ['urn:li:activity:1111111111111111111']);
  assert.equal(f.authorId, 'li:in:some-person');
  assert.ok(f.text.startsWith('Shipped the lighting pass'));
});

test('LinkedIn propagates on one tag', () => {
  assert.equal(li.policy.postHideThreshold, 1);
});

const SDUI_POST = `
  <div data-view-name="feed-full-update" componentkey="expanded7248110011223344555FeedType_MAIN_FEED_RELEVANCE">
    <a data-view-name="feed-actor-image" href="/in/dana-whitfield"><img alt=""></a>
    <a href="/in/dana-whitfield"><p>Dana Whitfield</p></a>
    <span data-testid="expandable-text-box">I fired my best engineer today. Read that again.</span>
    <a href="/feed/update/urn:li:activity:7248110011223344555/">2h</a>
    <div data-view-name="feed-update-image"><img src="https://media.licdn.com/x.jpg" width="1024" height="1024"></div>
  </div>`;

test('SDUI feed cards are posts, even with no data-urn', () => {
  mount(`<main><div data-testid="mainFeed">${SDUI_POST}</div></main>`);
  const root = li.feedRoot();
  assert.ok(root);
  const found = [...li.posts(root)];
  assert.equal(found.length, 1);
  assert.equal(li.diagnostics()['post'], '[data-view-name="feed-full-update"]');
});

test('SDUI post ids prefer a permalink URN over the componentkey token', () => {
  mount(`<main><div data-testid="mainFeed">${SDUI_POST}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.deepEqual(li.postIds(el), ['urn:li:activity:7248110011223344555']);
});

test('SDUI componentkey is the id when no URN is on the card', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-view-name="feed-full-update" componentkey="expandedabcXYZ99FeedType_MAIN_FEED_RELEVANCE">
      <span data-testid="expandable-text-box">no permalink here</span>
    </div>
  </div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.deepEqual(li.postIds(el), ['urn:li:fsd_update:abcXYZ99']);
});

test('SDUI actor image href is enough to attribute the author', () => {
  mount(`<main><div data-testid="mainFeed">${SDUI_POST}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  const a = li.author(el);
  assert.equal(a.id, 'li:in:dana-whitfield');
  assert.equal(a.kind, 'person');
});

test('SDUI body is the expandable text box', () => {
  mount(`<main><div data-testid="mainFeed">${SDUI_POST}</div></main>`);
  const el = [...li.posts(li.feedRoot()!)][0]!;
  assert.equal(li.text(el), 'I fired my best engineer today. Read that again.');
});

test('nested SDUI reshares count as one post', () => {
  mount(`<main><div data-testid="mainFeed">
    <div data-view-name="feed-full-update" componentkey="expandedouterFeedType_MAIN_FEED_RELEVANCE">
      <span data-testid="expandable-text-box">commentary</span>
      <div data-view-name="feed-full-update" componentkey="expandedinnerFeedType_MAIN_FEED_RELEVANCE">
        <span data-testid="expandable-text-box">original</span>
      </div>
    </div>
  </div></main>`);
  assert.equal([...li.posts(li.feedRoot()!)].length, 1);
});
