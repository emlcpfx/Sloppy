/**
 * The shared-list API the extension talks to.
 *
 * Empty `settings.apiBase` means this URL. A stored value is an override for
 * local wrangler / a self-hosted Worker — it is not a Settings field. Users
 * should never have to know a server exists.
 */

export const SHIPPED_API_BASE = 'https://sloppy-api.eric-0d2.workers.dev';

export const SHIPPED_API_HOST_PERMISSION = `${SHIPPED_API_BASE}/*`;

/** The address actually used for fetch. Empty storage → the shipped default. */
export function resolveApiBase(stored: string): string {
  const trimmed = stored.trim();
  return trimmed || SHIPPED_API_BASE;
}
