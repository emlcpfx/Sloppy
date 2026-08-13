/**
 * Settings.
 *
 * Also the iOS container app's main screen, eventually - Apple rejects apps
 * that are a shell around an extension, and making the container BE the options
 * UI clears that bar honestly instead of as a workaround. So this is written as
 * a standalone page, not as something that assumes a popup around it.
 */

import '../../src/ui/page.css';

import { CANONICAL_TAGS, SITE_IDS, tagLabel, type SiteId } from '@sloppy/core';
import { sendMessage, write } from '../../src/browser.ts';
import {
  KEYS,
  loadPrefs,
  loadRuleset,
  loadSettings,
  loadStats,
  savePrefs,
  saveSettings,
} from '../../src/state.ts';
import { h } from '../../src/ui/dom.ts';
import { splatIcon } from '../../src/ui/post-ui.ts';

const SITE_LABEL: Record<SiteId, string> = { linkedin: 'LinkedIn', reddit: 'Reddit' };

async function render(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const [prefs, settings, stats, ruleset] = await Promise.all([
    loadPrefs(),
    loadSettings(),
    loadStats(),
    loadRuleset(),
  ]);

  /** An empty subscription list means "every tag", which is the default. */
  const subscribed = new Set(prefs.subscribedTags.length ? prefs.subscribedTags : CANONICAL_TAGS);

  async function setSubscription(tag: string, on: boolean): Promise<void> {
    const next = new Set(subscribed);
    if (on) next.add(tag);
    else next.delete(tag);
    // Collapse "all of them" back to the empty list, so a tag added in a later
    // release is subscribed by default rather than silently missing.
    const list = next.size === CANONICAL_TAGS.length ? [] : [...next];
    await savePrefs({ ...prefs, subscribedTags: list });
    void render();
  }

  const rulesLive = ruleset.features.length > 0;

  app.replaceChildren(
    h(
      'header',
      {},
      h('span', { class: 'mark' }, splatIcon(30)),
      h('div', {}, h('h1', { text: 'Sloppy' }), h('p', { text: 'Settings' })),
    ),

    h(
      'section',
      {},
      h('h2', { text: 'Where it runs' }),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'Filtering', h('span', { class: 'sub', text: 'Turn everything off without uninstalling' })),
        checkbox(prefs.enabled, async (on) => {
          await savePrefs({ ...prefs, enabled: on });
          void render();
        }),
      ),
      ...SITE_IDS.map((site) =>
        h(
          'div',
          { class: 'field' },
          h('label', {}, SITE_LABEL[site]),
          checkbox(prefs.sites[site] !== false, async (on) => {
            await savePrefs({ ...prefs, sites: { ...prefs.sites, [site]: on } });
            void render();
          }),
        ),
      ),
    ),

    h(
      'section',
      {},
      h('h2', { text: 'Tags you hide' }),
      h('p', {
        class: 'note',
        text: 'Tags describe how a post is written, never whether it is right. That is deliberate — a style tag cannot be aimed at someone who does not write that way.',
      }),
      h(
        'div',
        { class: 'tags' },
        ...CANONICAL_TAGS.map((tag) => {
          const on = subscribed.has(tag);
          return h('button', {
            class: 'tag',
            type: 'button',
            text: tagLabel(tag),
            attrs: { 'data-on': on ? '1' : '0', 'aria-pressed': on ? 'true' : 'false' },
            on: { click: () => void setSubscription(tag, !on) },
          });
        }),
      ),
    ),

    h(
      'section',
      {},
      h('h2', { text: 'Phrasing rules' }),
      h('p', {
        class: 'note',
        text: rulesLive
          ? `${ruleset.features.length} rule(s) live. Lower the threshold to hide more.`
          : 'No phrasing rules are live yet. The engine ships wired and empty, so rules can be turned on later without a store update.',
      }),
      h(
        'div',
        { class: 'field' },
        h(
          'label',
          {},
          'Aggressiveness',
          h('span', { class: 'sub', text: `Hide at a score of ${prefs.threshold} or more` }),
        ),
        range(prefs.threshold, async (v) => {
          await savePrefs({ ...prefs, threshold: v });
          void render();
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'Use phrasing rules'),
        checkbox(prefs.rulesEnabled, async (on) => {
          await savePrefs({ ...prefs, rulesEnabled: on });
          void render();
        }),
      ),
    ),

    h(
      'section',
      {},
      h('h2', { text: 'Sharing' }),
      h('p', {
        class: 'note',
        text: 'On by default, so a tag you make can collapse the same post for other people. Turn it off and every tag stays on this device — nothing is ever sent anywhere. With it on, Sloppy uploads the post id, the author id, the tag and an anonymous install id — never the post text, and never which posts you looked at.',
      }),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'Share tags and use the shared list'),
        checkbox(settings.syncEnabled, async (on) => {
          await saveSettings({ ...settings, syncEnabled: on });
          await sendMessage({ type: 'sloppy:sync' });
          void render();
        }),
      ),
      h(
        'div',
        { class: 'row', style: { marginTop: '10px' } },
        h('button', {
          text: 'Sync now',
          on: {
            click: async (ev) => {
              const btn = ev.currentTarget as HTMLButtonElement;
              btn.textContent = 'Syncing…';
              await sendMessage({ type: 'sloppy:sync' });
              void render();
            },
          },
        }),
      ),
      h('p', {
        class: 'note',
        style: { marginTop: '8px', marginBottom: '0' },
        text: 'Rules from the shared list are re-checked for unsafe patterns before anything runs.',
      }),
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
      h('p', {
        class: 'note',
        style: { marginTop: '12px', marginBottom: '0' },
        text: 'Every "show anyway" is recorded on this device as a note that a hide was wrong. It is never uploaded.',
      }),
      h('p', {
        class: 'note',
        style: { marginTop: '8px', marginBottom: '0' },
        text: 'Accounts are only ever added to the shared repeat-poster list after a person reviews them, and anyone on it can ask to be removed. Individual posts you tag go to the shared list while sharing is on; turn it off and they stay on this device.',
      }),
    ),

    h(
      'section',
      {},
      h('h2', { text: 'Reset' }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'danger',
          text: 'Forget my tags',
          on: {
            click: async () => {
              for (const site of SITE_IDS) {
                await write('local', KEYS.localTags(site), []);
                await write('local', `overrides:${site}`, []);
              }
              void render();
            },
          },
        }),
        h('span', { class: 'muted', text: 'Clears local tags and every "show anyway" on this device.' }),
      ),
    ),

    h('footer', {}, 'Collapse, never delete. Every hide says why, and every hide can be undone.'),
  );
}

function checkbox(on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const el = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  el.checked = on;
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

function range(value: number, onChange: (v: number) => void): HTMLElement {
  const el = h('input', { attrs: { type: 'range', min: '1', max: '10', step: '0.5' } }) as HTMLInputElement;
  el.value = String(value);
  el.addEventListener('change', () => onChange(Number(el.value)));
  return el;
}

function stat(n: number, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('strong', { text: String(n) }), h('span', { text: label }));
}

void render();
