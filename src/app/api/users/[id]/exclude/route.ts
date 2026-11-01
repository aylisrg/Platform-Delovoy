import { auth } from "@/lib/auth";
import {
  apiError,
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { DomainError } from "@/modules/users/errors";
import { excludeFromTeam, getExclusionPreview } from "@/modules/users/exclusion";
import { excludeUserSchema, userIdParamSchema } from "@/modules/users/validation";

/**
 * GET  /api/users/[id]/exclude — preview for the confirmation window (AC-A1.2).
 * POST /api/users/[id]/exclude — «Исключить из команды» (AC-A1.3).
 *
 * SUPERADMIN only, even when the actor holds the «Пользователи» section
 * (AC-A1.10). ADR 2026-10-25-team-access-notifications §6.2.
 */

type Params = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.status, error.metadata);
  }
  console.error("[users/exclude] unexpected error", error);
  return apiServerError();
}

export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) return apiValidationError("Некорректный идентификатор пользователя");

  try {
    return apiResponse(await getExclusionPreview(id.data, session.user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) return apiValidationError("Некорректный идентификатор пользователя");

  // Empty body = no extra confirmations; malformed JSON is a validation error.
  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim() !== "") raw = JSON.parse(text);
  } catch {
    return apiValidationError("Некорректный JSON");
  }

  const parsed = excludeUserSchema.safeParse(raw);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const result = await excludeFromTeam(id.data, session.user.id, {
      confirmSeeded: parsed.data.confirmSeeded,
      via: "exclude",
    });
    return apiResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
