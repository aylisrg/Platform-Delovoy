import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { mergeClients } from "@/modules/clients/service";
import { mergeClientsSchema } from "@/modules/clients/validation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }
    if (session.user.role !== "SUPERADMIN") {
      return apiError("FORBIDDEN", "Только суперадмин может объединять клиентов", 403);
    }

    const body = await request.json();
    const parsed = mergeClientsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const result = await mergeClients(
      parsed.data.primaryId,
      parsed.data.secondaryId,
      session.user.id
    );
    return apiResponse(result);
  } catch (error) {
    if (error instanceof Error) {
      return apiError("MERGE_ERROR", error.message, 400);
    }
    console.error("[Clients] Merge error:", error);
    return apiServerError();
  }
}
