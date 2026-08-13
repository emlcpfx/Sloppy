/**
 * Founder immunity. Not a product feature — a joke with teeth.
 *
 * Tags against these author ids are refused by the Worker, dropped from the
 * snapshot, and ignored by `decide`. The client shows IMMUNE_MESSAGE instead
 * of collapsing the post.
 */

export const IMMUNE_MESSAGE = "I made Sloppy, you can't Slop me. LOL.";

const IMMUNE_AUTHOR_IDS = new Set([
  'li:in:ericlevy',
  'li:company:clean-plate-fx',
]);

/** Belt: even if author detection misses, this activity is his. */
const IMMUNE_POST_IDS = new Set(['urn:li:activity:7493503286445273089']);

export function immuneMessage(...ids: Array<string | null | undefined>): string | null {
  for (const id of ids) {
    if (id && (IMMUNE_AUTHOR_IDS.has(id) || IMMUNE_POST_IDS.has(id))) return IMMUNE_MESSAGE;
  }
  return null;
}

export function isImmuneAuthor(...ids: Array<string | null | undefined>): boolean {
  return ids.some((id) => !!id && IMMUNE_AUTHOR_IDS.has(id));
}

export function isImmunePost(...ids: Array<string | null | undefined>): boolean {
  return ids.some((id) => !!id && IMMUNE_POST_IDS.has(id));
}
