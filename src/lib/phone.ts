/**
 * Phone normalization for Russian numbers (E.164 +7XXXXXXXXXX).
 *
 * Used by:
 *   - Telegram deep-link bot handler — to look up existing User by phone
 *     when a contact is shared.
 *   - CRM `phoneNormalized` backfill / updates — for duplicate detection.
 *   - Auto-merge — to compare contact phones across providers.
 *
 * Strategy:
 *   1. Strip everything except digits and a leading `+`.
 *   2. Map common Russian variants to the canonical `+7XXXXXXXXXX` form
 *      (8 → +7, 7 without `+` → +7).
 *   3. Reject anything that does not look like a Russian mobile (length
 *      check + leading `9` for cellular). This is intentional — the park
 *      operates exclusively in Russia and we'd rather drop a malformed
 *      number than match the wrong user during auto-merge.
 *
 * Returns null for any unparseable input.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Keep digits and a single leading `+` only. Drop everything else
  // (spaces, dashes, parens, dots, etc.).
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;

  let normalized: string;

  if (hasLeadingPlus) {
    // +7XXXXXXXXXX — already canonical (after stripping non-digits the
    // `+` is gone; we re-add it).
    if (digits.length === 11 && digits.startsWith("7")) {
      normalized = `+${digits}`;
    } else {
      // Any other +-prefixed length is treated as non-Russian → reject.
      return null;
    }
  } else if (digits.length === 11 && digits.startsWith("8")) {
    // 8XXXXXXXXXX → +7XXXXXXXXXX
    normalized = `+7${digits.slice(1)}`;
  } else if (digits.length === 11 && digits.startsWith("7")) {
    // 7XXXXXXXXXX (no `+`) → +7XXXXXXXXXX
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    // Bare 10-digit number, e.g. 9001234567 — assume RU and add country code.
    normalized = `+7${digits}`;
  } else {
    return null;
  }

  // Final shape check: +7 + 10 digits.
  if (!/^\+7\d{10}$/.test(normalized)) return null;

  // RU mobile numbers always start with 9 after the country code.
  // Telegram's `request_contact` only returns mobile numbers, so this
  // is a strong signal that we got a real RU mobile — reject landlines
  // (4XX, 8XX) for the purposes of Telegram-bot login.
  if (normalized[2] !== "9") return null;

  return normalized;
}
