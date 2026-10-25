/**
 * The SUPERADMIN bootstrapped by `scripts/seeds/core.ts` on every deploy
 * (`upsert` by Telegram ID → role SUPERADMIN). One place of truth for the seed
 * and the app: excluding this account from the team is reverted by the next
 * deploy (warning, AC-A1.7) and merging it as the secondary account would make
 * the seed create a brand-new SUPERADMIN (blocked, AC-E2.4д).
 *
 * Leaf module: no DB, safe for scripts and client-free server code.
 * ADR 2026-10-25-team-access-notifications §5.0.
 */
export const DEFAULT_SUPERADMIN_TELEGRAM_ID = "694696";

export function getSeededSuperadminTelegramId(env: Partial<Record<string, string>> = process.env): string {
  return env.SUPERADMIN_TELEGRAM_ID ?? DEFAULT_SUPERADMIN_TELEGRAM_ID;
}

export function isSeededSuperadmin(
  user: { telegramId: string | null },
  env: Partial<Record<string, string>> = process.env,
): boolean {
  return user.telegramId !== null && user.telegramId === getSeededSuperadminTelegramId(env);
}
