import { auth } from "@/lib/auth";
import { apiError, apiForbidden, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { explainStaffNotifications } from "@/modules/notifications/explain";
import { setStaffEventSubscription } from "@/modules/notifications/subscriptions";
import { NotificationDomainError } from "@/modules/notifications/errors";
import { userIdParamSchema, userNotificationToggleSchema } from "@/modules/users/validation";

/**
 * GET   /api/users/[id]/notifications — «кто что получает» for one staff member (US-C1).
 * PATCH /api/users/[id]/notifications — the admin toggles one event (US-C2); the
 * same personal subscription the person sees in the Mini App Center, audited
 * with the actor. Also serves the team «Релизы» toggle and matrix clicks.
 * SUPERADMIN only (ADR 2026-10-25-team-access-notifications §6.2).
 */
type Params = { params: Promise<{ id: string }> };

type Guarded = { ok: true; actorId: string; userId: string } | { ok: false; response: Response };

async function guard(params: Params["params"]): Promise<Guarded> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: apiUnauthorized() };
  if (session.user.role !== "SUPERADMIN") return { ok: false, response: apiForbidden() };
  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) return { ok: false, response: apiValidationError("Некорректный идентификатор пользователя") };
  return { ok: true, actorId: session.user.id, userId: id.data };
}

export async function GET(_request: Request, { params }: Params) {
  const g = await guard(params);
  if (!g.ok) return g.response;
  try {
    const explain = (await explainStaffNotifications([g.userId])).get(g.userId);
    if (!explain) return apiError("USER_NOT_FOUND", "Пользователь не найден", 404);
    return apiResponse(explain);
  } catch (error) {
    console.error("[users/notifications] GET error", error);
    return apiServerError();
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const g = await guard(params);
  if (!g.ok) return g.response;

  const body: unknown = await request.json().catch(() => null);
  const parsed = userNotificationToggleSchema.safeParse(body);
  if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "Некорректный запрос");

  try {
    await setStaffEventSubscription({
      targetUserId: g.userId,
      eventType: parsed.data.eventType,
      enabled: parsed.data.enabled,
      actor: { userId: g.actorId, via: parsed.data.source === "matrix" ? "matrix" : "admin" },
    });
    // Return the recomputed row so the UI shows the new truth at once (AC-C1.8).
    const explain = (await explainStaffNotifications([g.userId])).get(g.userId);
    const event = explain?.categories.flatMap((c) => c.events).find((e) => e.eventType === parsed.data.eventType);
    return apiResponse(event ?? null);
  } catch (error) {
    if (error instanceof NotificationDomainError) return apiError(error.code, error.message, error.status);
    console.error("[users/notifications] PATCH error", error);
    return apiServerError();
  }
}
