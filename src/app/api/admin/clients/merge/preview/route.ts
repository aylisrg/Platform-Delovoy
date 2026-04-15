import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { previewMerge } from "@/modules/clients/service";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }
    if (session.user.role !== "SUPERADMIN") {
      return apiError("FORBIDDEN", "Только суперадмин может объединять клиентов", 403);
    }

    const { searchParams } = request.nextUrl;
    const primaryId = searchParams.get("primaryId");
    const secondaryId = searchParams.get("secondaryId");

    if (!primaryId || !secondaryId) {
      return apiError("VALIDATION_ERROR", "primaryId и secondaryId обязательны", 400);
    }
    if (primaryId === secondaryId) {
      return apiError("MERGE_SAME_USER", "Нельзя объединить клиента с самим собой", 400);
    }

    const preview = await previewMerge(primaryId, secondaryId);
    return apiResponse(preview);
  } catch (error) {
    if (error instanceof Error) {
      return apiError("PREVIEW_ERROR", error.message, 400);
    }
    console.error("[Clients] Merge preview error:", error);
    return apiServerError();
  }
}
