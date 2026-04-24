// @mention parser for task comments. Accepts a body and a set of candidate
// users; returns the subset that were actually mentioned.
// Pure / side-effect free.

export type MentionableUser = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * Extract raw mention tokens from a comment body: everything after "@" up to
 * the next whitespace or punctuation. Cyrillic letters, digits, dot,
 * underscore and hyphen are allowed inside a mention.
 */
export function extractMentionTokens(body: string): string[] {
  if (!body) return [];
  const tokens = new Set<string>();
  const re = /@([\p{L}\p{N}][\p{L}\p{N}._-]{0,63})/gu;
  for (const match of body.matchAll(re)) {
    tokens.add(match[1].toLowerCase());
  }
  return [...tokens];
}

/**
 * Return the users that match any mention token in the body.
 * A user matches if one of:
 *   - their email local-part (before @) equals the token
 *   - their name equals the token (case-insensitive, whitespace collapsed)
 *   - any single word in their name equals the token
 */
export function resolveMentions<T extends MentionableUser>(
  body: string,
  users: T[]
): T[] {
  const tokens = extractMentionTokens(body);
  if (!tokens.length) return [];

  const tokenSet = new Set(tokens);
  const matched: T[] = [];

  for (const user of users) {
    const candidates = new Set<string>();

    if (user.email) {
      const local = user.email.split("@")[0]?.toLowerCase();
      if (local) candidates.add(local);
    }

    if (user.name) {
      const normalized = user.name.trim().toLowerCase();
      candidates.add(normalized);
      for (const word of normalized.split(/\s+/)) {
        if (word) candidates.add(word);
      }
    }

    for (const c of candidates) {
      if (tokenSet.has(c)) {
        matched.push(user);
        break;
      }
    }
  }

  return matched;
}
