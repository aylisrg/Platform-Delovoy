import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { updatePreferenceSchema } from "@/modules/notifications/validation";

/**
 * GET /api/notifications/preferences
 * Get current user's notification preferences.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  try {
    const preference = await prisma.notificationPreference.findUnique({
      where: { userId: session.user.id },
    });

    // Also return available channels based on user's contact info
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        email: true,
        phone: true,
        telegramId: true,
        vkId: true,
      },
    });

    const availableChannels = [];
    if (user?.telegramId) availableChannels.push("TELEGRAM");
    if (user?.phone) availableChannels.push("WHATSAPP");
    if (user?.email) availableChannels.push("EMAIL");
    // VK removed from available channels

    return apiResponse({
      preference: preference || {
        preferredChannel: "AUTO",
        enableBooking: true,
        enableOrder: true,
        enableReminder: true,
      },
      availableChannels,
    });
  } catch {
    return apiServerError();
  }
}

/**
 * PUT /api/notifications/preferences
 * Update current user's notification preferences.
 */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();

  try {
    const body = await request.json();
    const parsed = updatePreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    const preference = await prisma.notificationPreference.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        ...parsed.data,
      },
      update: parsed.data,
    });

    return apiResponse(preference);
  } catch {
    return apiServerError();
  }
}
