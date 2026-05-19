import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { listChatsForAdmin } from "@/modules/messenger/service";
import { listAdminChatsQuerySchema } from "@/modules/messenger/validation";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role === "USER") return apiForbidden();

  const query = listAdminChatsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return apiError("VALIDATION_ERROR", query.error.message, 422);

  const result = await listChatsForAdmin(query.data);
  return apiResponse(result.chats, { limit: 50 });
}
