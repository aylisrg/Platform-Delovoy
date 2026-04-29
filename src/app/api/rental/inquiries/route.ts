import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createInquiry, listInquiries, RentalError } from "@/modules/rental/service";
import { createInquirySchema, inquiryFilterSchema } from "@/modules/rental/validation";
import { trackServerGoal } from "@/lib/metrika-server";

/**
 * POST /api/rental/inquiries — public, submit a rental inquiry (no auth).
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimit(request, "public");
    if (rateLimited) return rateLimited;

    const body = await request.json();
    const parsed = createInquirySchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const inquiry = await createInquiry(parsed.data);

    // Server-side трекинг конверсии в Я.Метрику — дублирует клиентский reachGoal,
    // который часто блокируется AdBlock/ITP. См. issue #225, fire-and-forget.
    trackServerGoal({
      request,
      target: "office_inquiry_success",
      // Заявка на офис — это lead, а не контракт. Цены ещё нет → передаём null.
      price: null,
    });

    return apiResponse(inquiry, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    console.error("[Rental] Inquiry creation error:", error);
    return apiServerError();
  }
}

/**
 * GET /api/rental/inquiries — admin only, list inquiries with optional filters.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = inquiryFilterSchema.safeParse(searchParams);
    const filter = parsed.success ? parsed.data : undefined;

    const inquiries = await listInquiries(filter);
    return apiResponse(inquiries);
  } catch (error) {
    console.error("[Rental] List inquiries error:", error);
    return apiServerError();
  }
}
