import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  getPreferences,
  upsertEventPreference,
} from "@/modules/notifications/dispatch/preferences-service";
import { eventPreferenceSchema } from "@/modules/notifications/dispatch/validation";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const data = await getPreferences(session.user.id);
    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const body = await request.json().catch(() => null);
    const parsed = eventPreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const { eventType, ...rest } = parsed.data;
    const pref = await upsertEventPreference(session.user.id, eventType, rest);
    return apiResponse(pref);
  } catch {
    return apiServerError();
  }
}
