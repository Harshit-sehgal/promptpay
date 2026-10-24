/** Mirrors the API rules for a CRM tag, so mistakes show before a request is sent. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const MAX_TAGS = 10;

export const TAG_RULE_MESSAGE =
  'Tags use lowercase letters, numbers and hyphens, start with a letter or number, and run up to 32 characters.';

export const isValidTag = (tag: string): boolean => TAG_PATTERN.test(tag);

export type TagInputResult = { ok: true; tags: string[] } | { ok: false; message: string };

/**
 * Turns what the operator typed (one tag or several split by commas) into the
 * full tag set to save: existing tags plus the new ones, lowercased, deduped
 * and sorted. Fails with a message for the first invalid tag or when the set
 * would go over the limit.
 */
export function addTagsToSet(existing: string[], raw: string): TagInputResult {
  const additions = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (additions.length === 0) return { ok: false, message: 'Enter a tag to add.' };
  const bad = additions.find((tag) => !isValidTag(tag));
  if (bad !== undefined)
    return { ok: false, message: `"${bad}" is not valid. ${TAG_RULE_MESSAGE}` };
  const next = [...new Set([...existing, ...additions])].sort();
  if (next.length > MAX_TAGS) {
    return { ok: false, message: `A person can have at most ${MAX_TAGS} tags.` };
  }
  return { ok: true, tags: next };
}
