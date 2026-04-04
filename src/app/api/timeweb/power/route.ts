import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { executeServerAction, TimewebError } from "@/modules/timeweb/service";
import { powerActionSchema } from "@/modules/timeweb/validation";
import { logAudit } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Невалидный JSON");
  }

  const parsed = powerActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0].message);
  }

  const { action } = parsed.data;

  try {
    await executeServerAction(action);

    await logAudit(
      session.user.id,
      `server.power.${action}`,
      "Server",
      process.env.TIMEWEB_SERVER_ID,
      { action }
    );

    return apiResponse({ action, status: "initiated" });
  } catch (error) {
    if (error instanceof TimewebError) {
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
