/**
 * Popup: is it on, is it working, how much has it caught.
 *
 * The health banner is the reason this screen exists. When LinkedIn changes its
 * markup the extension does not crash - it silently finds no posts, which from
 * the outside is indistinguishable from "this thing does nothing". Saying so
 * out loud turns an uninstall into a bug report.
 */

import '../../src/ui/page.css';

import { SITE_IDS, type SiteId } from '@sloppy/core';
import { openOptions, sendMessage } from '../../src/browser.ts';
import { loadHealth, loadPrefs, loadStats, savePrefs, type Health } from '../../src/state.ts';
import { h } from '../../src/ui/dom.ts';
import { splatIcon } from '../../src/ui/post-ui.ts';

const SITE_LABEL: Record<SiteId, string> = { linkedin: 'LinkedIn', reddit: 'Reddit' };

/** Health older than this tells us nothing - no feed has been open recently. */
const STALE_MS = 60_000;

async function render(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const [prefs, stats, health] = await Promise.all([
    loadPrefs(),
    loadStats(),
    Promise.all(SITE_IDS.map((s) => loadHealth(s))),
  ]);
  const status = await sendMessage<{ queued: number; syncEnabled: boolean }>({ type: 'sloppy:status' });

  const children: (Node | string | false)[] = [
    h(
      'header',
      {},
      h('span', { class: 'mark' }, splatIcon(30)),
      h('div', {}, h('h1', { text: 'Sloppy' }), h('p', { text: 'Community-tagged feed filtering' })),
    ),
  ];

  for (const w of health.filter(isBroken)) {
    const diag = Object.entries(w.diagnostics)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
    children.push(
      h(
        'div',
        { class: 'banner' },
        h('div', {
          text: `${SITE_LABEL[w.site]} markup changed — the feed was found but no posts matched. An update is needed.`,
        }),
        diag
          ? h('p', {
              class: 'muted',
              style: { margin: '6px 0 0', fontSize: '11px' },
              text: diag,
            })
          : false,
      ),
    );
  }

  children.push(
    h(
      'section',
      {},
      h(
        'div',
        { class: 'field' },
        h('label', { attrs: { for: 'enabled' } }, 'Filtering', h('span', { class: 'sub', text: 'Master switch' })),
        toggle('enabled', prefs.enabled, async (on) => {
          await savePrefs({ ...prefs, enabled: on });
          void render();
        }),
      ),
      ...SITE_IDS.map((site) =>
        h(
          'div',
          { class: 'field' },
          h('label', { attrs: { for: site } }, SITE_LABEL[site]),
          toggle(site, prefs.sites[site] !== false, async (on) => {
            await savePrefs({ ...prefs, sites: { ...prefs.sites, [site]: on } });
            void render();
          }),
        ),
      ),
    ),
    h(
      'section',
      {},
      h('h2', { text: 'So far' }),
      h(
        'div',
        { class: 'stats' },
        stat(stats.collapsed, 'filtered'),
        stat(stats.tagged, 'tagged'),
        stat(stats.unhidden, 'shown anyway'),
      ),
    ),
    h(
      'section',
      {},
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'primary', text: 'Settings', on: { click: () => openOptions() } }),
        status?.syncEnabled
          ? h('button', {
              text: 'Sync now',
              on: {
                click: async (ev) => {
                  const btn = ev.currentTarget as HTMLButtonElement;
                  btn.textContent = 'Syncing…';
                  await sendMessage({ type: 'sloppy:sync' });
                  void render();
                },
              },
            })
          : h('span', { class: 'muted', text: 'Local only — nothing leaves this device' }),
      ),
      status && status.queued > 0
        ? h('p', { class: 'muted', text: `${status.queued} tag(s) waiting to upload` })
        : false,
    ),
  );

  app.replaceChildren(...children.filter(Boolean).map((c) => (typeof c === 'string' ? document.createTextNode(c) : (c as Node))));
}

/**
 * A feed we found but could not read any posts from is the interesting case.
 * "No feed" usually just means the tab is not on one.
 */
function isBroken(health: Health | null): health is Health {
  if (!health) return false;
  if (Date.now() - health.checkedAt > STALE_MS) return false;
  return health.feedFound && health.postCount === 0;
}

function toggle(id: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = h('input', { attrs: { type: 'checkbox', id } });
  (input as HTMLInputElement).checked = on;
  input.addEventListener('change', () => onChange((input as HTMLInputElement).checked));
  return input;
}

function stat(n: number, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('strong', { text: String(n) }), h('span', { text: label }));
}

void render();
