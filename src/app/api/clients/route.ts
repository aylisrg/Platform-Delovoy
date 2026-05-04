import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { listClients, createClient, ClientError } from "@/modules/clients/service";
import {
  clientFilterSchema,
  createClientSchema,
} from "@/modules/clients/validation";

/**
 * GET /api/clients — list of guest cards (USER role) with search & pagination.
 * F4 ADR — MANAGER+ access (CRM is a cross-cutting section, see ADR §8).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = clientFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { clients, total } = await listClients(parsed.data);
    return apiResponse(
      { clients, total },
      {
        total,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      }
    );
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/clients — manually create a guest card.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiForbidden("Требуется роль менеджера");
    }

    const body = await request.json();
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { id } = await createClient(parsed.data, session.user.id);
    return apiResponse({ id }, undefined, 201);
  } catch (error) {
    if (error instanceof ClientError) {
      const status =
        error.code === "CLIENT_PHONE_DUPLICATE"
          ? 409
          : error.code === "INVALID_PHONE"
            ? 422
            : 400;
      return apiError(error.code, error.message, status, error.metadata);
    }
    return apiServerError();
  }
}
