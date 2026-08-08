/**
 * Capture screenshots of the real built extension driving a fabricated feed.
 *
 * Same harness as the e2e test - this is the running extension, not a mockup.
 *   node e2e/shots.mjs [outDir]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, '..', '.output', 'chrome-mv3');
const OUT = process.argv[2] ?? '/tmp/sloppy-shots';
const PREINSTALLED = '/opt/pw-browsers/chromium';
const CHROME = process.env.SLOPPY_CHROME || (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

const POSTS = [
  {
    urn: 'urn:li:activity:1111111111111111111',
    who: 'Dana Whitfield',
    role: 'Head of Innovation Strategy',
    body: "I fired my best engineer today.\n\nRead that again.\n\nLet it sink in.\n\nHe was brilliant. He shipped. But he wouldn't align with the vision.\n\nIt's not a talent problem, it's a belief problem.\n\nAgree?",
  },
  {
    urn: 'urn:li:activity:2222222222222222222',
    who: 'Priya Raghunathan',
    role: 'Compositing Supervisor',
    body: 'Finally wrapped the third-act cleanup. Six weeks of roto on a sequence nobody will consciously notice, which is rather the point of the job.\n\nGrateful to the team who sat through the review rounds with me.',
  },
  {
    urn: 'urn:li:activity:3333333333333333333',
    who: 'Orbital Forge Studios',
    role: 'Virtual production · 4,102 followers',
    body: 'Our latest concept frames — generated in minutes, not weeks. The future of previz is here.',
    image: true,
  },
];

const feedHtml = () => `<!doctype html>
<html><head><meta charset="utf-8"><title>Feed</title><style>
  :root { color-scheme: light; }
  body { margin:0; background:#f4f2ee; font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; color:#1b1f23; }
  .col { max-width: 560px; margin: 0 auto; padding: 20px 12px 40px; }
  .card { background:#fff; border:1px solid #e3e2df; border-radius:10px; margin-bottom:12px; padding:14px 16px 16px; }
  .who { display:flex; gap:10px; align-items:center; margin-bottom:10px; }
  .av { width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg,#c9d3dd,#9fb0bf); flex:none; }
  .who b { display:block; font-size:14px; }
  .who span { font-size:12px; color:#5e6670; }
  .body { white-space:pre-wrap; font-size:14px; }
  .shot { margin-top:12px; height:190px; border-radius:6px;
          background:linear-gradient(140deg,#5b3d8f,#2f6f9e 45%,#c8734a); }
  .acts { display:flex; gap:22px; margin-top:12px; padding-top:9px; border-top:1px solid #edecea;
          font-size:13px; color:#5e6670; font-weight:600; }
  @media (prefers-color-scheme: dark) {
    body { background:#1b1f23; color:#e9e6e2; }
    .card { background:#26292d; border-color:#34383d; }
    .who span, .acts { color:#a2a9b0; }
    .acts { border-top-color:#34383d; }
  }
</style></head><body><main><div class="col" data-testid="mainFeed">
${POSTS.map(
  (p) => `  <div class="card feed-shared-update-v2" data-urn="${p.urn}">
    <div class="who update-components-actor" data-urn="urn:li:member:${p.urn.slice(-4)}">
      <div class="av"></div>
      <div><a href="/in/${p.who.toLowerCase().replace(/[^a-z]+/g, '-')}"><b>${p.who}</b></a><span>${p.role}</span></div>
    </div>
    <div class="body update-components-text">${p.body}</div>
    ${p.image ? '<div class="shot update-components-image"></div>' : ''}
    <div class="acts"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
  </div>`,
).join('\n')}
</div></main></body></html>`;

async function shoot(colorScheme) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sloppy-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: true,
    colorScheme,
    viewport: { width: 620, height: 900 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--no-sandbox'],
  });

  await context.route('**://*.linkedin.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: feedHtml() }),
  );

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-sloppy-host]', { timeout: 20_000 });

  const suffix = colorScheme === 'dark' ? '-dark' : '';
  const card = (urn) => page.locator(`[data-urn="${urn}"]`);

  // 1. The button, revealed on hover.
  await page.hover(`[data-urn="${POSTS[0].urn}"]`);
  await page.waitForTimeout(300);
  await card(POSTS[0].urn).screenshot({ path: join(OUT, `1-button${suffix}.png`) });

  // 2. The tag picker, open.
  const box = await page.locator(`[data-urn="${POSTS[0].urn}"] > [data-sloppy-host]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('[data-sloppy-host][data-open="1"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `2-picker${suffix}.png`), clip: await clipOf(page, POSTS[0].urn, 250) });

  // 3. Collapsed, with the reason and a way back.
  await page.keyboard.press('Enter');
  await page.waitForSelector(`[data-urn="${POSTS[0].urn}"][data-sloppy-collapsed="1"]`, { timeout: 5000 });
  await page.waitForTimeout(300);
  await card(POSTS[0].urn).screenshot({ path: join(OUT, `3-stub${suffix}.png`) });

  // 4. The feed as a whole: one collapsed, the rest untouched.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `4-feed${suffix}.png`) });

  // 5 + 6. The extension's own surfaces.
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const id = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.setViewportSize({ width: 680, height: 1180 });
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForTimeout(400);
  await options.screenshot({ path: join(OUT, `5-options${suffix}.png`), fullPage: true });
  await options.close();

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 460 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: join(OUT, `6-popup${suffix}.png`), fullPage: true });
  await popup.close();

  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

/** The card plus room below it for an open popover. */
async function clipOf(page, urn, extra) {
  const b = await page.locator(`[data-urn="${urn}"]`).boundingBox();
  return {
    x: Math.max(0, b.x - 8),
    y: Math.max(0, b.y - 8),
    width: b.width + 16,
    height: Math.min(b.height + extra, 900 - b.y),
  };
}

mkdirSync(OUT, { recursive: true });
await shoot('light');
await shoot('dark');
console.log(`wrote screenshots to ${OUT}`);
