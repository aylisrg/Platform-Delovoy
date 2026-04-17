import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiServerError,
} from "@/lib/api-response";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { webappPreferenceSchema } from "@/modules/notifications/validation";
import {
  getUserPreferences,
  updateUserPreferences,
} from "@/modules/notifications/service";

/**
 * GET /api/webapp/preferences
 * Get notification preferences for the Mini App user.
 */
export async function GET(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    const data = await getUserPreferences(webappUser.id);
    return apiResponse(data);
  } catch (error) {
    console.error("[WebApp Preferences GET] Error:", error);
    return apiServerError();
  }
}

/**
 * PUT /api/webapp/preferences
 * Update notification preferences from Mini App.
 */
export async function PUT(request: NextRequest) {
  try {
    const webappUser = await verifyWebAppToken(request);
    if (!webappUser) {
      return apiError("UNAUTHORIZED", "Необходима авторизация", 401);
    }

    const body = await request.json();
    const parsed = webappPreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues.map((i) => i.message).join(", "),
        422
      );
    }

    const preference = await updateUserPreferences(webappUser.id, parsed.data);
    return apiResponse({
      enableBooking: preference.enableBooking,
      enableOrder: preference.enableOrder,
      enableReminder: preference.enableReminder,
      preferredChannel: preference.preferredChannel,
    });
  } catch (error) {
    console.error("[WebApp Preferences PUT] Error:", error);
    return apiServerError();
  }
}
