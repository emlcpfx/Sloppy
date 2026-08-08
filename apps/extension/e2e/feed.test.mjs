/**
 * End-to-end: load the real built extension into a real Chromium and drive it
 * against a fabricated LinkedIn feed.
 *
 * This exists because "it builds" and "it works" are different claims, and the
 * P0 exit condition in the plan is behavioural: injection has to survive
 * scrolling and re-renders. Those are exactly the failures a unit test cannot
 * see - the adapter tests prove the selectors parse markup, and nothing below
 * the browser can prove the observer puts the button back after React throws it
 * away.
 *
 * The feed is served by intercepting linkedin.com, so no account, no network
 * and no real person's data is involved.
 *
 * ONE CONSEQUENCE OF THE CLOSED SHADOW ROOT: the test cannot query the button,
 * the picker or the stub - `element.shadowRoot` is null by design, for
 * Playwright exactly as for LinkedIn. So the UI is driven the way a person
 * without a mouse would: click at the host's coordinates, then use the
 * keyboard. Everything asserted is either light-DOM state or extension storage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, '..', '.output', 'chrome-mv3');

/**
 * Undefined lets Playwright use the browser it installed itself, which is what
 * CI does. The explicit path is for environments that ship a pre-installed
 * Chromium at a different build number than this Playwright expects.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium';
const CHROME =
  process.env.SLOPPY_CHROME || (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

const POST_A = 'urn:li:activity:1111111111111111111';
const POST_B = 'urn:li:activity:2222222222222222222';
const POST_C = 'urn:li:activity:3333333333333333333';

const post = (urn, body) => `
  <div data-urn="${urn}" class="feed-shared-update-v2">
    <div class="update-components-actor" data-urn="urn:li:member:${urn.slice(-3)}">
      <a href="/in/person-${urn.slice(-3)}"><span>Person ${urn.slice(-3)}</span></a>
    </div>
    <div class="update-components-text">${body}</div>
  </div>`;

const FEED_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Feed</title>
<style>body{margin:0;font:14px system-ui} [data-urn]{border:1px solid #ddd;margin:12px;padding:16px;min-height:90px}</style>
</head><body>
  <main>
    <div data-testid="mainFeed" id="feed">
      ${post(POST_A, 'I fired my best engineer today. Read that again.')}
      ${post(POST_B, 'Shipped the lighting pass. Notes are in the sheet.')}
      ${post(POST_C, 'Third post, entirely unremarkable.')}
    </div>
  </main>
</body></html>`;

async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sloppy-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--no-sandbox',
    ],
  });

  // Serve the fabricated feed in place of the real site.
  await context.route('**://*.linkedin.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FEED_HTML }),
  );

  return { context, userDataDir };
}

async function extensionId(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return new URL(worker.url()).host;
}

/** Centre of the host element, in page coordinates. */
async function hostBox(page, urn) {
  return page.locator(`[data-urn="${urn}"] > [data-sloppy-host]`).boundingBox();
}

test('the extension injects, tags, collapses and survives a re-render', async (t) => {
  const { context, userDataDir } = await launch();
  const page = await context.newPage();

  t.after(async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

  // ---- injection -------------------------------------------------------
  await page.waitForSelector('[data-sloppy-host]', { timeout: 20_000 });
  assert.equal(
    await page.locator('[data-sloppy-host]').count(),
    3,
    'every post should get exactly one host',
  );
  assert.equal(
    await page.locator('[data-sloppy-post]').count(),
    3,
    'every post should be marked for the collapse stylesheet',
  );

  // ---- the button is hidden until you want it --------------------------
  const opacityOf = (urn) =>
    page.$eval(`[data-urn="${urn}"] > [data-sloppy-host]`, (el) => getComputedStyle(el).opacity);
  assert.equal(await opacityOf(POST_A), '0', 'the button should stay out of the way until hover');

  await page.hover(`[data-urn="${POST_A}"]`);
  await page.waitForFunction(
    (urn) =>
      getComputedStyle(document.querySelector(`[data-urn="${urn}"] > [data-sloppy-host]`)).opacity === '1',
    POST_A,
    { timeout: 5000 },
  );

  // ---- tag it ----------------------------------------------------------
  // Closed shadow root: click by coordinate, then drive the picker by keyboard.
  const box = await hostBox(page, POST_A);
  assert.ok(box, 'host should be laid out');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.waitForSelector('[data-sloppy-host][data-open="1"]', { timeout: 5000 });

  // The first chip is focused when the picker opens, so Enter commits it.
  await page.keyboard.press('Enter');

  await page.waitForSelector(`[data-urn="${POST_A}"][data-sloppy-collapsed="1"]`, { timeout: 5000 });

  // The site's own content is hidden, not destroyed - "collapse, don't delete".
  const bodyStillThere = await page.$eval(
    `[data-urn="${POST_A}"] .update-components-text`,
    (el) => ({ present: true, hidden: getComputedStyle(el).display === 'none' || el.offsetParent === null }),
  );
  assert.equal(bodyStillThere.present, true, 'the post element must not be removed');
  assert.equal(bodyStillThere.hidden, true, 'the post content must not be drawn');

  // Untouched posts are untouched.
  assert.equal(await page.locator(`[data-urn="${POST_B}"][data-sloppy-collapsed="1"]`).count(), 0);

  // ---- the tag actually persisted --------------------------------------
  const id = await extensionId(context);
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${id}/options.html`);
  const stored = await optionsPage.evaluate(() => chrome.storage.local.get('localTags:linkedin'));
  const tags = stored['localTags:linkedin'] ?? [];
  assert.equal(tags.length, 1, 'exactly one tag should have been recorded');
  assert.equal(tags[0].postId, POST_A);
  assert.ok(tags[0].tag.length > 0);
  await optionsPage.close();

  // ---- survive a re-render ---------------------------------------------
  // React reconciliation throws our host away; the observer has to put it back
  // AND re-apply the collapsed state, or a hidden post pops back into the feed.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-sloppy-host]')) el.remove();
    for (const el of document.querySelectorAll('[data-sloppy-post]')) {
      el.removeAttribute('data-sloppy-post');
      el.removeAttribute('data-sloppy-collapsed');
    }
    // Force a mutation so the observer has something to react to.
    document.getElementById('feed').appendChild(document.createComment('rerender'));
  });

  await page.waitForFunction(
    () => document.querySelectorAll('[data-sloppy-host]').length === 3,
    undefined,
    { timeout: 5000 },
  );
  await page.waitForSelector(`[data-urn="${POST_A}"][data-sloppy-collapsed="1"]`, { timeout: 5000 });

  // ---- virtualisation recycles nodes -----------------------------------
  // Same element, different post. The verdict must be recomputed, or a recycled
  // node keeps showing the previous post's stub.
  await page.evaluate(
    ([tagged, fresh]) => {
      document.querySelector(`[data-urn="${tagged}"]`).setAttribute('data-urn', fresh);
    },
    [POST_A, 'urn:li:activity:9999999999999999999'],
  );

  await page.waitForFunction(
    () => !document.querySelector('[data-urn="urn:li:activity:9999999999999999999"][data-sloppy-collapsed="1"]'),
    undefined,
    { timeout: 5000 },
  );

  // And the reverse: recycle an untagged node onto the tagged post's id.
  await page.evaluate(
    ([untagged, tagged]) => {
      document.querySelector(`[data-urn="${untagged}"]`).setAttribute('data-urn', tagged);
    },
    [POST_C, POST_A],
  );
  await page.waitForSelector(`[data-urn="${POST_A}"][data-sloppy-collapsed="1"]`, { timeout: 5000 });
});

test('"show anyway" brings a collapsed post back and remembers the decision', async (t) => {
  const { context, userDataDir } = await launch();
  const page = await context.newPage();

  t.after(async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-sloppy-host]', { timeout: 20_000 });

  // Tag it, so there is something to un-hide.
  await page.hover(`[data-urn="${POST_B}"]`);
  const box = await hostBox(page, POST_B);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('[data-sloppy-host][data-open="1"]', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector(`[data-urn="${POST_B}"][data-sloppy-collapsed="1"]`, { timeout: 5000 });

  // The stub sits in flow now, with [show] at its right-hand end.
  const stub = await hostBox(page, POST_B);
  await page.mouse.click(stub.x + stub.width - 38, stub.y + stub.height / 2);

  await page.waitForFunction(
    (urn) => !document.querySelector(`[data-urn="${urn}"][data-sloppy-collapsed="1"]`),
    POST_B,
    { timeout: 5000 },
  );

  // The post is back AND the disagreement was recorded - unhides are the only
  // negative-label source there is, so losing them loses the whole signal.
  const id = await extensionId(context);
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${id}/options.html`);
  const stored = await optionsPage.evaluate(() =>
    chrome.storage.local.get(['negatives', 'overrides:linkedin', 'stats']),
  );
  assert.equal(stored['overrides:linkedin']?.includes(POST_B), true, 'the override should persist');
  assert.equal(stored.negatives?.length, 1, 'the unhide should be recorded as a negative label');
  assert.equal(stored.stats?.unhidden, 1);
  await optionsPage.close();
});

test('Reddit works through the same engine, with its own policy', async (t) => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sloppy-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--no-sandbox'],
  });

  t.after(async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  await context.route('**://*.reddit.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta charset="utf-8"><style>
        shreddit-post{display:block;border:1px solid #ddd;margin:12px;padding:16px;min-height:80px}
      </style></head><body><shreddit-feed>
        <shreddit-post id="t3_aaa111" author="someone" post-title="I made this with AI" post-type="image"
          content-href="https://i.redd.it/x.png"><div slot="text-body">ten minutes</div></shreddit-post>
        <shreddit-post id="t3_bbb222" author="another" post-title="Weekly discussion" post-type="text">
        </shreddit-post>
      </shreddit-feed></body></html>`,
    }),
  );

  const page = await context.newPage();
  await page.goto('https://www.reddit.com/r/vfx/', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('[data-sloppy-host]', { timeout: 20_000 });
  assert.equal(await page.locator('[data-sloppy-host]').count(), 2, 'both shreddit-posts get a host');

  // Reddit's policy waits for three reporters before a post hides for everyone -
  // but your OWN tag must still hide it for you, immediately. Consensus governs
  // what other people see; it has no business overruling you about your feed.
  await page.hover('[id="t3_aaa111"]');
  const box = await page.locator('[id="t3_aaa111"] > [data-sloppy-host]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('[data-sloppy-host][data-open="1"]', { timeout: 5000 });
  await page.keyboard.press('Enter');

  await page.waitForSelector('[id="t3_aaa111"][data-sloppy-collapsed="1"]', { timeout: 5000 });
  assert.equal(await page.locator('[id="t3_bbb222"][data-sloppy-collapsed="1"]').count(), 0);
});

test('new posts scrolled into the feed are injected too', async (t) => {
  const { context, userDataDir } = await launch();
  const page = await context.newPage();

  t.after(async () => {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-sloppy-host]', { timeout: 20_000 });

  // Infinite scroll: the feed appends, the observer picks them up.
  await page.evaluate(() => {
    const feed = document.getElementById('feed');
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-urn', `urn:li:activity:70000000000000000${String(i).padStart(2, '0')}`);
      el.className = 'feed-shared-update-v2';
      const text = document.createElement('div');
      text.className = 'update-components-text';
      text.textContent = `appended post ${i}`;
      el.appendChild(text);
      feed.appendChild(el);
    }
  });

  await page.waitForFunction(() => document.querySelectorAll('[data-sloppy-host]').length === 15, undefined, {
    timeout: 8000,
  });
  assert.equal(await page.locator('[data-sloppy-host]').count(), 15);
});
