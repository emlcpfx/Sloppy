/**
 * The only code that talks to a server, and it is optional.
 *
 * NO PER-POST REQUESTS, EVER. The client pulls the whole blocklist on a timer
 * and matches locally. That is what keeps feed rendering off the network - and,
 * more importantly, it means the server never learns which posts a given person
 * is looking at, because it is never asked about one.
 *
 * The only outbound traffic is a tag POST when somebody clicks the splat, and
 * the periodic snapshot pull.
 */

import { zRuleset, zSnapshot } from '@sloppy/core/schema';
import type { Ruleset, SiteId, Snapshot, TagEvent } from '@sloppy/core';

export class ApiError extends Error {}

const TIMEOUT_MS = 15_000;

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, credentials: 'omit' });
    if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function base(apiBase: string): string {
  return apiBase.replace(/\/+$/, '');
}

/**
 * Fetch and VALIDATE. A snapshot is remote data that decides what a person does
 * and does not see; parsing it loosely would let a malformed - or hostile -
 * response hide arbitrary posts. Validation lives here, at the boundary, and
 * nowhere else.
 */
export async function fetchSnapshot(apiBase: string, site: SiteId, since = 0): Promise<Snapshot> {
  const url = `${base(apiBase)}/snapshot?site=${encodeURIComponent(site)}&since=${since}`;
  const res = await request(url);
  const parsed = zSnapshot.safeParse(await res.json());
  if (!parsed.success) throw new ApiError(`snapshot failed validation: ${parsed.error.issues[0]?.message}`);
  return parsed.data as Snapshot;
}

export async function fetchRuleset(apiBase: string): Promise<Ruleset> {
  const res = await request(`${base(apiBase)}/ruleset`);
  const parsed = zRuleset.safeParse(await res.json());
  if (!parsed.success) throw new ApiError(`ruleset failed validation: ${parsed.error.issues[0]?.message}`);
  return parsed.data as Ruleset;
}

export async function postTag(apiBase: string, installId: string, event: TagEvent): Promise<void> {
  await request(`${base(apiBase)}/tag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      site: event.site,
      postId: event.postId,
      authorId: event.authorId,
      authorKind: event.authorKind,
      tag: event.tag,
      textHash: event.textHash,
      installId,
    }),
  });
}
