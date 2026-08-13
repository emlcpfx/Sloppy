import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_ROLLUP, promotableTags, rollupAuthors, rollupPosts, type TagRow } from './rollup.ts';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function row(over: Partial<TagRow> = {}): TagRow {
  return {
    post_id: 'p1',
    author_id: 'a1',
    author_kind: 'person',
    site: 'linkedin',
    tag: 'ai-text',
    install_id: 'i1',
    ts: NOW,
    ...over,
  };
}

test('one post, three reporters, counted once each', () => {
  const posts = rollupPosts([
    row({ install_id: 'i1' }),
    row({ install_id: 'i2' }),
    row({ install_id: 'i3' }),
    // A duplicate from an install already counted must not inflate n.
    row({ install_id: 'i3' }),
  ]);
  assert.deepEqual(posts, [{ id: 'p1', tag: 'ai-text', n: 3 }]);
});

test('the winning tag is the one most installs agree on', () => {
  const posts = rollupPosts([
    row({ install_id: 'i1', tag: 'broetry' }),
    row({ install_id: 'i2', tag: 'broetry' }),
    row({ install_id: 'i3', tag: 'ai-text' }),
  ]);
  assert.equal(posts[0]?.tag, 'broetry');
  // n counts distinct reporters overall, not just those who picked the winner.
  assert.equal(posts[0]?.n, 3);
});

test('ties break deterministically, so two rebuilds agree', () => {
  const rows = [row({ install_id: 'i1', tag: 'listicle' }), row({ install_id: 'i2', tag: 'ai-text' })];
  const a = rollupPosts(rows);
  const b = rollupPosts([...rows].reverse());
  assert.deepEqual(a, b);
  assert.equal(a[0]?.tag, 'ai-text');
});

test('an author needs both bars: enough posts AND enough distinct reporters', () => {
  const manyPostsOneReporter = Array.from({ length: 8 }, (_, i) =>
    row({ post_id: `p${i}`, install_id: 'i1' }),
  );
  assert.deepEqual(rollupAuthors(manyPostsOneReporter, DEFAULT_ROLLUP, NOW), []);

  const manyReportersFewPosts = Array.from({ length: 8 }, (_, i) =>
    row({ post_id: 'p1', install_id: `i${i}` }),
  );
  assert.deepEqual(rollupAuthors(manyReportersFewPosts, DEFAULT_ROLLUP, NOW), []);

  const both = [
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i1' })),
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i2' })),
  ];
  const promoted = rollupAuthors(both, DEFAULT_ROLLUP, NOW);
  assert.equal(promoted.length, 1);
  assert.deepEqual(promoted[0], {
    id: 'a1',
    kind: 'person',
    tag: 'ai-text',
    flaggedPosts: 5,
    reporters: 2,
  });
});

test('the window rolls - old flags stop counting', () => {
  const stale = [
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i1', ts: NOW - 100 * DAY })),
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i2', ts: NOW - 100 * DAY })),
  ];
  assert.deepEqual(rollupAuthors(stale, DEFAULT_ROLLUP, NOW), []);

  // Same flags, inside 90 days.
  const fresh = stale.map((r) => ({ ...r, ts: NOW - 10 * DAY }));
  assert.equal(rollupAuthors(fresh, DEFAULT_ROLLUP, NOW).length, 1);
});

test('anonymous posts never promote an author', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    row({ post_id: `p${i}`, install_id: `i${i % 4}`, author_id: null }),
  );
  assert.deepEqual(rollupAuthors(rows, DEFAULT_ROLLUP, NOW), []);
});

test('company accounts keep their kind, so they can carry their own threshold', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i1', author_kind: 'org' })),
    ...Array.from({ length: 5 }, (_, i) => row({ post_id: `p${i}`, install_id: 'i2', author_kind: 'org' })),
  ];
  assert.equal(rollupAuthors(rows, DEFAULT_ROLLUP, NOW)[0]?.kind, 'org');
});

test('a coined tag stays private until enough installs use it independently', () => {
  const canonical = ['ai-text'];
  const fewUsers = Array.from({ length: 9 }, (_, i) =>
    row({ post_id: `p${i}`, tag: 'corporate-mad-libs', install_id: i < 6 ? 'i1' : 'i2' }),
  );
  // Nine uses, but only two people. Not a shared vocabulary.
  assert.deepEqual(promotableTags(fewUsers, canonical), []);

  const manyUsers = Array.from({ length: 5 }, (_, i) =>
    row({ post_id: `p${i}`, tag: 'corporate-mad-libs', install_id: `i${i}` }),
  );
  assert.deepEqual(promotableTags(manyUsers, canonical), ['corporate-mad-libs']);
});

test('canonical tags are never treated as pending promotion', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row({ post_id: `p${i}`, install_id: `i${i}` }));
  assert.deepEqual(promotableTags(rows, ['ai-text']), []);
});
