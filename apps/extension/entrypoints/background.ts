/**
 * Background service worker: the snapshot timer and the tag outbox.
 *
 * Both jobs exist so the content script never has to care about the network.
 * A failed tag POST retries quietly in here; it must never surface as an error
 * in somebody's feed, because from their side the click already worked - the
 * post is already hidden locally.
 */

import { defineBackground } from 'wxt/utils/define-background';
import { SITE_IDS, type SiteId, type TagEvent } from '@sloppy/core';
import { alarms, onMessage, read, runtime, write } from '../src/browser.ts';
import { fetchRuleset, fetchSnapshot, postTag } from '../src/api.ts';
import { resolveApiBase } from '../src/api-base.ts';
import { KEYS, installId, loadSettings, saveRuleset, saveSettings, saveSnapshot } from '../src/state.ts';

const ALARM = 'sloppy:sync';

interface QueuedTag {
  event: TagEvent;
  tries: number;
}

/** After this many failures the tag is dropped. It is one tag, not an invoice. */
const MAX_TRIES = 8;

export default defineBackground(() => {
  runtime.onInstalled.addListener(() => {
    void installId();
    void scheduleSync();
  });

  runtime.onStartup?.addListener(() => {
    void scheduleSync();
  });

  alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === ALARM) void syncAll();
  });

  onMessage(async (message: { type?: string } & Record<string, unknown>) => {
    switch (message?.type) {
      case 'sloppy:tag':
        await enqueue(message as unknown as TagMessage);
        void drain();
        return { ok: true };

      case 'sloppy:sync':
        return await syncAll();

      case 'sloppy:status':
        return await status();

      default:
        return undefined;
    }
  });

  void scheduleSync();
});

interface TagMessage {
  site: SiteId;
  postId: string;
  authorId: string | null;
  authorKind: TagEvent['authorKind'];
  tag: string;
  textHash: string;
}

async function scheduleSync(): Promise<void> {
  const settings = await loadSettings();
  try {
    await alarms.clear(ALARM);
  } catch {
    // No alarm to clear on a fresh profile.
  }
  if (!settings.syncEnabled) return;
  alarms.create(ALARM, { periodInMinutes: Math.max(15, settings.syncIntervalMinutes) });
  void syncAll();
}

/**
 * Local-only is a real, supported mode - not a degraded one.
 *
 * Turning sharing off skips the network. The extension keeps working entirely
 * from the local tag list.
 */
async function syncAll(): Promise<{ ok: boolean; reason?: string; sites?: number }> {
  const settings = await loadSettings();
  if (!settings.syncEnabled) return { ok: true, reason: 'local-only' };
  const apiBase = resolveApiBase(settings.apiBase);

  let synced = 0;
  let stampBits = settings.stampBits;

  for (const site of SITE_IDS) {
    try {
      const snapshot = await fetchSnapshot(apiBase, site);
      await saveSnapshot(site, snapshot);
      if (snapshot.stampBits) stampBits = snapshot.stampBits;
      synced++;
    } catch (err) {
      console.warn(`[sloppy] snapshot sync failed for ${site}`, err);
    }
  }

  // Difficulty rides along in the snapshot so it can be raised without a store
  // resubmission. The schema bounds it, so a hostile value cannot make the
  // miner run for a week.
  if (stampBits !== settings.stampBits) await saveSettings({ ...settings, stampBits });

  try {
    // Already sanitised by fetchRuleset - only features that passed the same
    // safety analysis CI runs are ever stored, let alone compiled.
    const { ruleset } = await fetchRuleset(apiBase);
    await saveRuleset(ruleset);
  } catch (err) {
    console.warn('[sloppy] ruleset sync failed', err);
  }

  await drain();
  return { ok: true, sites: synced };
}

async function enqueue(msg: TagMessage): Promise<void> {
  const event: TagEvent = {
    site: msg.site,
    postId: msg.postId,
    authorId: msg.authorId,
    authorKind: msg.authorKind,
    tag: msg.tag,
    textHash: msg.textHash,
    ts: Date.now(),
  };
  const queue = await read<QueuedTag[]>('local', KEYS.queue, []);
  if (queue.some((q) => q.event.postId === event.postId && q.event.tag === event.tag)) return;
  queue.push({ event, tries: 0 });
  await write('local', KEYS.queue, queue);
}

let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const settings = await loadSettings();
    const queue = await read<QueuedTag[]>('local', KEYS.queue, []);
    if (queue.length === 0) return;

    // Sharing off: hold the queue rather than dropping it, so turning it back
    // on still ships what was tagged in the meantime.
    if (!settings.syncEnabled) return;

    const id = await installId();
    const remaining: QueuedTag[] = [];
    const apiBase = resolveApiBase(settings.apiBase);

    for (const item of queue) {
      try {
        await postTag(apiBase, id, item.event, settings.stampBits);
      } catch {
        const tries = item.tries + 1;
        if (tries < MAX_TRIES) remaining.push({ ...item, tries });
      }
    }

    await write('local', KEYS.queue, remaining);
  } finally {
    draining = false;
  }
}

async function status(): Promise<{ queued: number; syncEnabled: boolean; apiBase: string }> {
  const [queue, settings] = await Promise.all([
    read<QueuedTag[]>('local', KEYS.queue, []),
    loadSettings(),
  ]);
  return { queued: queue.length, syncEnabled: settings.syncEnabled, apiBase: resolveApiBase(settings.apiBase) };
}
