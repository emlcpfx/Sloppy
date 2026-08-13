export * from './adapter.ts';
export { linkedinAdapter } from './linkedin.ts';
export { redditAdapter } from './reddit.ts';

import type { SiteId } from '@sloppy/core';
import type { SiteAdapter } from './adapter.ts';
import { linkedinAdapter } from './linkedin.ts';
import { redditAdapter } from './reddit.ts';

export const ADAPTERS: readonly SiteAdapter[] = [linkedinAdapter, redditAdapter];

export function adapterFor(site: SiteId): SiteAdapter {
  const a = ADAPTERS.find((x) => x.id === site);
  if (!a) throw new Error(`no adapter for site: ${site}`);
  return a;
}
