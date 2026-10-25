/**
 * Domain errors of the notifications module (ADR 2026-10-25 §4). Routes map
 * them to `apiError(code, message, status)`; messages are user-facing Russian
 * texts without internal ids.
 */
export class NotificationDomainError extends Error {
  constructor(
    readonly code: "UNKNOWN_EVENT" | "NOT_IN_TEAM" | "NO_ACCESS_TO_CATEGORY" | "USER_NOT_FOUND",
    message: string,
    readonly status: 404 | 422,
  ) {
    super(message);
    this.name = "NotificationDomainError";
  }
}
