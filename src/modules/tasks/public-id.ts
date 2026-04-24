// Short human-facing task IDs: "TASK-ABCDE".
// Alphabet excludes 0/O/1/I/L to avoid ambiguity in emails, phone quotes, or
// handwritten tickets.

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PREFIX = "TASK-";
const LENGTH = 5;

/**
 * Generate a random public ID like "TASK-K7H3Q". Not cryptographically secure —
 * collisions handled by retry at the DB layer.
 */
export function generatePublicId(): string {
  let body = "";
  for (let i = 0; i < LENGTH; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    body += ALPHABET[idx];
  }
  return PREFIX + body;
}

/**
 * Extract a publicId from free-form text (email subject, chat message). Returns
 * the normalized uppercase form or null. The whole prefix+body is matched —
 * partial tokens ("TASK-") are ignored.
 */
export function parsePublicId(input: string): string | null {
  if (!input) return null;
  const alphabetChar = `[${ALPHABET}]`;
  const re = new RegExp(`TASK-${alphabetChar}{${LENGTH}}`, "i");
  const match = input.toUpperCase().match(re);
  return match ? match[0] : null;
}

/**
 * True if `s` is a well-formed public ID (strict match, no surrounding text).
 */
export function isPublicId(s: string): boolean {
  if (!s) return false;
  const re = new RegExp(`^TASK-[${ALPHABET}]{${LENGTH}}$`);
  return re.test(s);
}

export const PUBLIC_ID_ALPHABET = ALPHABET;
