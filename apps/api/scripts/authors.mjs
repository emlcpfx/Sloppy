#!/usr/bin/env node
/**
 * Review the author list.
 *
 *   pnpm --filter @sloppy/api authors pending
 *   pnpm --filter @sloppy/api authors approve urn:li:member:123 linkedin "posts AI reels daily"
 *   pnpm --filter @sloppy/api authors reject  urn:li:member:123 linkedin "appeal upheld"
 *   pnpm --filter @sloppy/api authors list
 *
 * Add --local to work against the local D1 from `wrangler dev`.
 *
 * ---------------------------------------------------------------------------
 * WHY A CLI AND NOT AN ADMIN ENDPOINT
 * ---------------------------------------------------------------------------
 * An admin API would need its own secret, and that secret would then need
 * protecting, rotating, and keeping out of logs - a new authenticated surface
 * whose compromise hands somebody the power to silence anyone. This goes
 * through `wrangler`, so the authentication is the operator's existing
 * Cloudflare login and there is no new credential in the system at all.
 *
 * The cost is that approving somebody requires a terminal. At community scale
 * that is a handful of decisions a week, and the friction is arguably the point.
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const local = args.includes('--local');
const positional = args.filter((a) => a !== '--local');
const [command, ...rest] = positional;

/** Ids come from the operator's own shell, but a stray quote breaks the SQL. */
const SAFE_ID = /^[A-Za-z0-9:_@./-]{1,128}$/;
const SITES = ['linkedin', 'reddit'];

function sql(statement) {
  const argv = ['d1', 'execute', 'sloppy', local ? '--local' : '--remote', '--json', '--command', statement];
  const run = spawnSync('npx', ['wrangler', ...argv], { encoding: 'utf8' });

  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    process.exit(run.status ?? 1);
  }
  try {
    const parsed = JSON.parse(run.stdout);
    return parsed[0]?.results ?? [];
  } catch {
    console.log(run.stdout);
    return [];
  }
}

/** Single-quote escaping, SQLite style. */
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

function requireArgs(id, site) {
  if (!id || !SAFE_ID.test(id)) {
    console.error(`[authors] not a usable author id: ${id ?? '(missing)'}`);
    process.exit(1);
  }
  if (!SITES.includes(site)) {
    console.error(`[authors] site must be one of ${SITES.join(', ')} - got ${site ?? '(missing)'}`);
    process.exit(1);
  }
}

function table(rows, columns) {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log(columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

function pending() {
  // Candidates with no decision on record. A rejection is sticky, so somebody
  // already cleared stays cleared instead of resurfacing every night.
  const rows = sql(`
    SELECT c.author_id, c.site, c.kind, c.tag, c.flagged_posts, c.distinct_reporters
      FROM author_candidates c
      LEFT JOIN author_decisions d ON d.author_id = c.author_id AND d.site = c.site
     WHERE d.author_id IS NULL
     ORDER BY c.flagged_posts DESC, c.author_id
  `);

  console.log(`\n${rows.length} author(s) awaiting a decision.\n`);
  table(rows, ['author_id', 'site', 'kind', 'tag', 'flagged_posts', 'distinct_reporters']);

  if (rows.length > 0) {
    console.log(
      '\nApproving an author hides EVERYTHING they post, for everyone subscribed\n' +
        'to that tag. Look at the posts before you decide.\n',
    );
  }
}

function decide(decision, id, site, note = '') {
  requireArgs(id, site);
  const now = Date.now();
  const by = process.env.SLOPPY_OPERATOR ?? process.env.USER ?? 'unknown';

  const statements = [
    `INSERT INTO author_decisions (author_id, site, decision, decided_at, decided_by, note)
     VALUES (${q(id)}, ${q(site)}, ${q(decision)}, ${now}, ${q(by)}, ${q(note)})
     ON CONFLICT (author_id, site) DO UPDATE SET
       decision = excluded.decision, decided_at = excluded.decided_at,
       decided_by = excluded.decided_by, note = excluded.note`,
  ];

  if (decision === 'approved') {
    statements.push(`
      INSERT INTO authors (author_id, site, kind, tag, flagged_posts, distinct_reporters,
                           window_end, approved_at, approved_by, note)
      SELECT author_id, site, kind, tag, flagged_posts, distinct_reporters, window_end,
             ${now}, ${q(by)}, ${q(note)}
        FROM author_candidates WHERE author_id = ${q(id)} AND site = ${q(site)}
      ON CONFLICT (author_id, site) DO UPDATE SET
        approved_at = ${now}, approved_by = ${q(by)}, note = ${q(note)}`);
  } else {
    // Rejection removes them from the served list immediately. This is also the
    // path an upheld appeal takes - see docs/APPEALS.md.
    statements.push(`DELETE FROM authors WHERE author_id = ${q(id)} AND site = ${q(site)}`);
  }

  for (const s of statements) sql(s);
  console.log(`[authors] ${id} on ${site}: ${decision}${note ? ` (${note})` : ''}`);

  if (decision === 'approved') {
    const check = sql(`SELECT COUNT(*) AS n FROM authors WHERE author_id = ${q(id)} AND site = ${q(site)} AND approved_at IS NOT NULL`);
    if ((check[0]?.n ?? 0) === 0) {
      console.error('[authors] WARNING: nothing was inserted - is this id still a candidate?');
      process.exit(1);
    }
  }
}

function list() {
  const rows = sql(`
    SELECT author_id, site, tag, flagged_posts, distinct_reporters, approved_by, note
      FROM authors WHERE approved_at IS NOT NULL ORDER BY site, author_id
  `);
  console.log(`\n${rows.length} approved author(s) - these are live in the snapshot.\n`);
  table(rows, ['author_id', 'site', 'tag', 'flagged_posts', 'distinct_reporters', 'approved_by', 'note']);
}

switch (command) {
  case 'pending':
    pending();
    break;
  case 'approve':
    decide('approved', rest[0], rest[1], rest[2]);
    break;
  case 'reject':
    decide('rejected', rest[0], rest[1], rest[2]);
    break;
  case 'list':
    list();
    break;
  default:
    console.error(
      'usage: authors <pending|approve|reject|list> [authorId] [site] [note] [--local]\n' +
        '\n' +
        '  pending  candidates the rollup proposed and nobody has decided on\n' +
        '  approve  put an author on the live list (hides everything they post)\n' +
        '  reject   keep them off it, permanently - also how an appeal is upheld\n' +
        '  list     who is currently on the live list',
    );
    process.exit(command ? 1 : 0);
}
