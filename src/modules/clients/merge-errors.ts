import { DomainError } from "@/modules/users/errors";

/**
 * Domain errors of the account-merge engine and the merge-request queue
 * (ADR 2026-10-25-team-access-notifications §4). Same `DomainError` class as
 * the `users` module, so the admin routes map both with one `instanceof`.
 * Messages are Russian and shown to the operator as-is (PRD «Тексты интерфейса»).
 */

export { DomainError, isDomainError } from "@/modules/users/errors";

export const MERGE_ERROR_MESSAGES = {
  USER_NOT_FOUND: "Пользователь не найден",
  SAME_ACCOUNT: "Нельзя объединить аккаунт сам с собой",
  ALREADY_MERGED: "Этот аккаунт уже объединён с другим",
  SECONDARY_IS_ACTOR: "Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным",
  SECONDARY_SEEDED_SUPERADMIN: "Этот аккаунт привязан к настройке сервера. Выберите его основным",
  LAST_SUPERADMIN:
    "После объединения не останется ни одного суперадмина. Выберите основным аккаунт суперадмина или сначала назначьте другого",
  TELEGRAM_CONFLICT_UNCONFIRMED: "У аккаунтов разные Telegram — подтвердите, какой оставить",
  ACTIVE_SUBSCRIPTION_CONFLICT:
    "У обоих аккаунтов активный абонемент — объединение невозможно, пока один не завершён",
  MERGE_REQUEST_NOT_FOUND: "Запрос на объединение не найден",
  MERGE_REQUEST_CLOSED: "Запрос на объединение уже закрыт",
} as const;

export type MergeErrorCode = keyof typeof MERGE_ERROR_MESSAGES;

/** Guards that block a merge; the preview lists them instead of throwing. */
export type MergeBlockerCode =
  | "ALREADY_MERGED"
  | "SECONDARY_IS_ACTOR"
  | "SECONDARY_SEEDED_SUPERADMIN"
  | "LAST_SUPERADMIN"
  | "ACTIVE_SUBSCRIPTION_CONFLICT";

const STATUS: Record<MergeErrorCode, 404 | 409 | 422> = {
  USER_NOT_FOUND: 404,
  SAME_ACCOUNT: 422,
  ALREADY_MERGED: 409,
  SECONDARY_IS_ACTOR: 409,
  SECONDARY_SEEDED_SUPERADMIN: 409,
  LAST_SUPERADMIN: 409,
  TELEGRAM_CONFLICT_UNCONFIRMED: 409,
  ACTIVE_SUBSCRIPTION_CONFLICT: 409,
  MERGE_REQUEST_NOT_FOUND: 404,
  MERGE_REQUEST_CLOSED: 409,
};

export function mergeError(code: MergeErrorCode, metadata?: Record<string, unknown>): DomainError {
  return new DomainError(code, MERGE_ERROR_MESSAGES[code], STATUS[code], metadata);
}
