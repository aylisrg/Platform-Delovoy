import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { searchUsers } from "@/modules/messenger/service";
import { userSearchQuerySchema } from "@/modules/messenger/validation";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const query = userSearchQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return apiError("VALIDATION_ERROR", query.error.message, 422);

  const isAdmin = session.user.role !== "USER";
  const users = await searchUsers(query.data.q, query.data.limit, session.user.id, isAdmin);
  return apiResponse(users);
}
