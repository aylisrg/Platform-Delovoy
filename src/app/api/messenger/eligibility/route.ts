import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { canStartDirect } from "@/modules/messenger/service";
import { eligibilitySchema } from "@/modules/messenger/validation";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const parsed = eligibilitySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.message, 422);

  const result = await canStartDirect(session.user.id, parsed.data.otherUserId);
  return apiResponse(result);
}
