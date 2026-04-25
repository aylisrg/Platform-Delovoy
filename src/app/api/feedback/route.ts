import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  createFeedback,
  listFeedback,
  RateLimitError,
  OfficeNotFoundError,
} from "@/modules/feedback/service";
import { createFeedbackSchema, feedbackFilterSchema } from "@/modules/feedback/validation";
import { saveScreenshot, getScreenshotPath } from "@/modules/feedback/file-storage";
import { sendUrgentFeedbackAlert } from "@/modules/feedback/telegram";
import { SCREENSHOT_CONSTRAINTS } from "@/modules/feedback/validation";

/**
 * GET /api/feedback — list feedback items
 * USER: own items only. SUPERADMIN: all items with filters.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = feedbackFilterSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message || "Некорректные параметры");
    }

    const result = await listFeedback(session.user.id, session.user.role, parsed.data);

    return apiResponse(result.items, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/feedback — create a new feedback item
 * Accepts multipart/form-data (for screenshot upload).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const contentType = request.headers.get("content-type") || "";
    let type: string | undefined;
    let description: string | undefined;
    let pageUrl: string | undefined;
    let isUrgent: string | boolean | undefined;
    let officeId: string | undefined;
    let screenshotFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      type = formData.get("type") as string;
      description = formData.get("description") as string;
      pageUrl = formData.get("pageUrl") as string;
      isUrgent = formData.get("isUrgent") as string;
      officeId = (formData.get("officeId") as string | null) ?? undefined;
      const file = formData.get("screenshot");
      if (file instanceof File && file.size > 0) {
        screenshotFile = file;
      }
    } else {
      const body = await request.json();
      type = body.type;
      description = body.description;
      pageUrl = body.pageUrl;
      isUrgent = body.isUrgent;
      officeId = body.officeId;
    }

    // Validate fields
    const parsed = createFeedbackSchema.safeParse({
      type,
      description,
      pageUrl,
      isUrgent,
      officeId,
    });
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message || "Некорректные данные");
    }

    // Validate screenshot if provided
    if (screenshotFile) {
      if (screenshotFile.size > SCREENSHOT_CONSTRAINTS.maxSizeBytes) {
        return apiValidationError("Файл слишком большой (максимум 5 МБ)");
      }
      if (
        !SCREENSHOT_CONSTRAINTS.allowedMimeTypes.includes(
          screenshotFile.type as (typeof SCREENSHOT_CONSTRAINTS.allowedMimeTypes)[number]
        )
      ) {
        return apiValidationError("Допустимые форматы: PNG, JPG, WEBP");
      }
    }

    // Create feedback item first (to get ID for filename)
    // We'll update with screenshot path after saving file
    let screenshotPath: string | undefined;

    const result = await createFeedback(session.user.id, {
      ...parsed.data,
      screenshotPath: undefined, // Will update after file save
    });

    // Save screenshot if provided
    if (screenshotFile) {
      try {
        screenshotPath = await saveScreenshot(result.id, screenshotFile);
        // Update the feedback item with the screenshot path
        const { prisma } = await import("@/lib/db");
        await prisma.feedbackItem.update({
          where: { id: result.id },
          data: { screenshotPath },
        });

        // Re-send Telegram alert with screenshot for urgent items
        // (initial alert in service.ts fires before screenshot is saved)
        if (parsed.data.isUrgent) {
          sendUrgentFeedbackAlert({
            feedbackId: result.id,
            type: parsed.data.type,
            description: parsed.data.description,
            userName: session.user.name || session.user.email || "Пользователь",
            pageUrl: parsed.data.pageUrl,
            screenshotPath: getScreenshotPath(screenshotPath),
          }).catch((err) => {
            console.error("[Feedback] Failed to send TG screenshot:", err);
          });
        }
      } catch (err) {
        console.error("[Feedback] Failed to save screenshot:", err);
        // Don't fail the whole request — feedback was created
      }
    }

    return apiResponse(
      {
        id: result.id,
        type: parsed.data.type,
        description: parsed.data.description,
        screenshotUrl: screenshotPath ? `/api/feedback/uploads/${screenshotPath}` : null,
        pageUrl: parsed.data.pageUrl,
        isUrgent: parsed.data.isUrgent,
        status: "NEW",
      },
      undefined,
      201
    );
  } catch (error) {
    if (error instanceof RateLimitError) {
      return apiError(error.code, error.message, 429);
    }
    if (error instanceof OfficeNotFoundError) {
      return apiValidationError(error.message);
    }
    console.error("[Feedback API] POST error:", error);
    return apiServerError();
  }
}
