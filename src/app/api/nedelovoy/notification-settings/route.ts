import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { updateRentalSettingsSchema } from "@/modules/rental/validation";
import { getOrCreateSettings } from "@/modules/rental/notifications";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const settings = await getOrCreateSettings("nedelovoy");
    return apiResponse(settings);
  } catch {
    return apiServerError();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const body = await request.json();
    const parsed = updateRentalSettingsSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const before = await getOrCreateSettings("nedelovoy");

    const updated = await prisma.rentalNotificationSettings.update({
      where: { parkSlug: "nedelovoy" },
      data: {
        ...parsed.data,
        updatedById: session!.user.id,
      },
    });

    await logAudit(
      session!.user.id,
      "rental_notification_settings.updated",
      "RentalNotificationSettings",
      updated.id,
      { parkSlug: "nedelovoy", before, after: updated }
    );
    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
