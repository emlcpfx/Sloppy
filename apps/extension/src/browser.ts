/**
 * The one place that touches the extension APIs directly.
 *
 * `browser` vs `chrome`: both work in every target WXT builds for, and WXT
 * normalises them - but going through a single local shim means the rest of the
 * codebase has no opinion, and a Safari-only quirk gets fixed here rather than
 * in fifteen call sites.
 *
 * Storage split, and why it is not arbitrary:
 *   - `sync`  : preferences and the install id. Free cross-device sync with no
 *               account, no email and no server. Small quota, so nothing bulky.
 *   - `local` : the snapshot, the ruleset, the retry queue. Big, regenerable,
 *               and pointless to sync - every device refetches it anyway.
 *
 * Safari's `sync` behaviour is the one to verify early; `readSync` falls back to
 * local so subscriptions degrade to per-device rather than failing silently.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const api: any = (globalThis as any).browser ?? (globalThis as any).chrome;

export const runtime = api.runtime;
export const alarms = api.alarms;
export const tabs = api.tabs;

type Area = 'sync' | 'local';

function area(name: Area): any {
  return api.storage[name];
}

export async function read<T>(name: Area, key: string, fallback: T): Promise<T> {
  try {
    const got = await area(name).get(key);
    const v = got?.[key];
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export async function write(name: Area, key: string, value: unknown): Promise<void> {
  await area(name).set({ [key]: value });
}

/**
 * Read from sync, falling back to local.
 *
 * Not paranoia: on iOS Safari `storage.sync` has historically behaved
 * differently, and a silent failure here means somebody's tag subscriptions
 * quietly reset. Degrading to per-device is the acceptable outcome; losing
 * their settings is not.
 */
export async function readSynced<T>(key: string, fallback: T): Promise<T> {
  const fromSync = await read<T | undefined>('sync', key, undefined);
  if (fromSync !== undefined) return fromSync;
  return read<T>('local', key, fallback);
}

export async function writeSynced(key: string, value: unknown): Promise<void> {
  await write('local', key, value);
  try {
    await write('sync', key, value);
  } catch {
    // Quota or an unsupported area - local already has it.
  }
}

export function onStorageChanged(fn: (changes: Record<string, unknown>, areaName: string) => void): void {
  api.storage.onChanged.addListener(fn);
}

/** Errors are swallowed on purpose: a closed popup rejects, and that is normal. */
export function sendMessage<T = unknown>(message: unknown): Promise<T | undefined> {
  return Promise.resolve(runtime.sendMessage(message)).catch(() => undefined);
}

export function onMessage(
  fn: (message: any, sender: any) => unknown | Promise<unknown>,
): void {
  runtime.onMessage.addListener((message: any, sender: any, sendResponse: (r: unknown) => void) => {
    Promise.resolve(fn(message, sender)).then(
      (r) => sendResponse(r),
      (e) => sendResponse({ error: String(e?.message ?? e) }),
    );
    // Keep the channel open for the async response.
    return true;
  });
}

export function openOptions(): void {
  if (runtime.openOptionsPage) runtime.openOptionsPage();
}

/** crypto.randomUUID is available in every target this ships to. */
export function newInstallId(): string {
  return crypto.randomUUID();
}
