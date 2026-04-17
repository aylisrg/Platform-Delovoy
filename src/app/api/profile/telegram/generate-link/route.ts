import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiUnauthorized, apiServerError } from "@/lib/api-response";
import { generateDeepLink, LinkError } from "@/modules/telegram-link/service";

/**
 * POST /api/profile/telegram/generate-link
 * Generate a one-time deep link for linking Telegram from the website.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const result = await generateDeepLink(session.user.id);
    return apiResponse(result);
  } catch (error) {
    if (error instanceof LinkError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("[Profile Telegram Link] Error:", error);
    return apiServerError();
  }
}
