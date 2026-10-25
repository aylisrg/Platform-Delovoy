/**
 * Domain errors of the `users` module (ADR 2026-10-25-team-access-notifications §4).
 *
 * Routes map `DomainError` → `apiError(code, message, status, metadata)`;
 * anything else is answered with a generic 500 without details. Messages are
 * Russian, shown to the operator as-is: no internal ids, no technical codes.
 */

export type DomainErrorStatus = 400 | 403 | 404 | 409 | 410 | 422 | 429 | 502 | 503;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: DomainErrorStatus,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** UI texts — PRD 2026-10-25 «Тексты интерфейса», AC-A1.6 / AC-A1.7 / AC-A3.1. */
export const USER_ERROR_MESSAGES = {
  CANNOT_EXCLUDE_SELF: "Нельзя исключить самого себя",
  CANNOT_DEMOTE_SELF: "Нельзя понизить роль самому себе",
  CANNOT_DELETE_SELF: "Нельзя удалить самого себя",
  LAST_SUPERADMIN: "Нельзя исключить последнего суперадмина. Сначала назначьте другого",
  LAST_SUPERADMIN_DEMOTE: "Нельзя понизить последнего суперадмина. Сначала назначьте другого",
  NOT_IN_TEAM: "Пользователь не входит в команду",
  ALREADY_EXCLUDED: "Пользователь уже не входит в команду",
  SEEDED_SUPERADMIN_CONFIRM_REQUIRED:
    "Этот аккаунт назначен суперадмином в настройках сервера. При ближайшем обновлении платформы роль вернётся автоматически. Чтобы исключение осталось, сначала смените настройку сервера.",
  USER_HAS_HISTORY_TEAM:
    "Удалить нельзя: у аккаунта есть история. Мы не удаляем аккаунты с журналом действий, бронями и заказами. Исключите сотрудника из команды — доступ закроется, история сохранится.",
  USER_HAS_HISTORY_CLIENT:
    "Удалить нельзя: у аккаунта есть история. Аккаунты с историей не удаляются. Жёсткое удаление не поддерживается.",
  USER_NOT_FOUND: "Пользователь не найден",
  USER_MERGED: "Этот аккаунт объединён с другим",
  ROLE_CHANGED_CONCURRENTLY: "Роль пользователя только что изменилась. Обновите страницу и повторите",
  SECTION_UNKNOWN: "Неизвестный раздел",
} as const;

export const userNotFound = () =>
  new DomainError("USER_NOT_FOUND", USER_ERROR_MESSAGES.USER_NOT_FOUND, 404);

export const userMerged = (primaryUserId: string) =>
  new DomainError("USER_MERGED", USER_ERROR_MESSAGES.USER_MERGED, 409, { primaryUserId });

export const seededConfirmRequired = () =>
  new DomainError(
    "SEEDED_SUPERADMIN_CONFIRM_REQUIRED",
    USER_ERROR_MESSAGES.SEEDED_SUPERADMIN_CONFIRM_REQUIRED,
    409,
    { requiresConfirmation: "seeded_superadmin" },
  );
