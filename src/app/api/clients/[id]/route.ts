import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import {
  getClientDetail,
  updateClient,
  ClientError,
} from "@/modules/clients/service";
import { updateClientSchema } from "@/modules/clients/validation";

/**
 * GET /api/clients/:id — full guest card detail (server endpoint complement
 * to the existing /admin/clients/[id] page; lets the edit form refetch after
 * PATCH without a full page reload).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const { id } = await params;
    const client = await getClientDetail(id);
    if (!client) return apiNotFound("Гость не найден");
    return apiResponse(client);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/clients/:id — update editable fields. Phone is locked.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    await updateClient(id, parsed.data, session.user.id);
    return apiResponse({ id });
  } catch (error) {
    if (error instanceof ClientError) {
      const status = error.code === "CLIENT_NOT_FOUND" ? 404 : 400;
      return apiError(error.code, error.message, status, error.metadata);
    }
    return apiServerError();
  }
}
