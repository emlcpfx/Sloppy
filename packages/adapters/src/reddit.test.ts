import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { featuresFrom } from './adapter.ts';
import { redditAdapter as rd } from './reddit.ts';

function mount(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  (globalThis as { document?: unknown }).document = document;
  return document;
}

const NEW_REDDIT = `
<shreddit-feed>
  <shreddit-post
    id="t3_1abc234"
    author="someuser"
    subreddit-prefixed-name="r/vfx"
    post-title="I made this with AI and I think it's basically a real shot"
    post-type="image"
    content-href="https://i.redd.it/abc.png">
    <div slot="text-body"><p>Took about ten minutes.</p></div>
  </shreddit-post>
  <shreddit-post id="t3_1def567" author="other" post-title="Weekly thread" post-type="text">
  </shreddit-post>
</shreddit-feed>`;

const OLD_REDDIT = `
<div id="siteTable">
  <div class="thing" data-fullname="t3_1abc234" data-author="someuser"
       data-subreddit="vfx" data-domain="i.redd.it" data-url="https://i.redd.it/abc.png">
    <a class="title" href="/r/vfx/x">I made this with AI</a>
    <div class="usertext-body"><div class="md"><p>Took about ten minutes.</p></div></div>
  </div>
</div>`;

test('new Reddit reads everything off the light-DOM host', () => {
  mount(NEW_REDDIT);
  const root = rd.feedRoot();
  assert.ok(root);
  const items = [...rd.posts(root)];
  assert.equal(items.length, 2);

  const first = items[0]!;
  assert.deepEqual(rd.postIds(first), ['t3_1abc234']);
  assert.deepEqual(rd.author(first), { id: 'rd:u:someuser', kind: 'person', vanity: 'someuser' });
  assert.deepEqual(rd.media(first), [{ kind: 'image', src: 'https://i.redd.it/abc.png' }]);
});

test('title and body are scored together, because a link post has no body', () => {
  mount(NEW_REDDIT);
  const [first, second] = [...rd.posts(rd.feedRoot()!)];
  assert.equal(
    rd.text(first!),
    "I made this with AI and I think it's basically a real shot\n\nTook about ten minutes.",
  );
  assert.equal(rd.text(second!), 'Weekly thread');
});

test('old.reddit is the same adapter, one branch down', () => {
  mount(OLD_REDDIT);
  const root = rd.feedRoot();
  assert.ok(root);
  const el = [...rd.posts(root)][0]!;

  assert.deepEqual(rd.postIds(el), ['t3_1abc234']);
  assert.deepEqual(rd.author(el), { id: 'rd:u:someuser', kind: 'person', vanity: 'someuser' });
  assert.equal(rd.text(el), 'I made this with AI\n\nTook about ten minutes.');
  assert.deepEqual(rd.media(el), [{ kind: 'image', src: 'https://i.redd.it/abc.png' }]);
  assert.equal(rd.diagnostics()['post'], 'div.thing[data-fullname^="t3_"]');
});

test('a deleted account is null rather than an author called "[deleted]"', () => {
  mount('<shreddit-feed><shreddit-post id="t3_x" author="[deleted]"></shreddit-post></shreddit-feed>');
  const el = [...rd.posts(rd.feedRoot()!)][0]!;
  assert.equal(rd.author(el).id, null);
});

test('a comment host is not mistaken for a post', () => {
  mount('<shreddit-feed><shreddit-comment thingid="t1_abc"></shreddit-comment></shreddit-feed>');
  assert.equal([...rd.posts(rd.feedRoot()!)].length, 0);
});

test('Reddit waits for consensus where LinkedIn cannot', () => {
  // Everyone sees the same objects here, so the threshold is reachable - and a
  // threshold of 1 would hand one user reach over every reader of the sub.
  assert.equal(rd.policy.postHideThreshold, 3);
});

test('featuresFrom is site-agnostic - same call, same shape', () => {
  mount(NEW_REDDIT);
  const el = [...rd.posts(rd.feedRoot()!)][0]!;
  const f = featuresFrom(rd, el);
  assert.equal(f.site, 'reddit');
  assert.deepEqual(f.postIds, ['t3_1abc234']);
  assert.equal(f.authorId, 'rd:u:someuser');
  assert.equal(f.media.length, 1);
});
