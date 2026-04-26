import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { upsertGlobalPreference } from "@/modules/notifications/dispatch/preferences-service";
import { globalPreferenceSchema } from "@/modules/notifications/dispatch/validation";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const pref = await prisma.notificationGlobalPreference.findUnique({
      where: { userId: session.user.id },
    });
    return apiResponse(pref);
  } catch {
    return apiServerError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const body = await request.json().catch(() => null);
    const parsed = globalPreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const pref = await upsertGlobalPreference(session.user.id, parsed.data);
    return apiResponse(pref);
  } catch {
    return apiServerError();
  }
}
