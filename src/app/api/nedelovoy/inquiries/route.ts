import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createInquiry, listInquiries, RentalError } from "@/modules/rental/service";
import { createInquirySchema, inquiryFilterSchema } from "@/modules/rental/validation";

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimit(request, "public");
    if (rateLimited) return rateLimited;

    const body = await request.json();
    const parsed = createInquirySchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const inquiry = await createInquiry({ ...parsed.data, parkSlug: "nedelovoy" });

    return apiResponse(inquiry, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    console.error("[Nedelovoy] Inquiry creation error:", error);
    return apiServerError();
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = inquiryFilterSchema.safeParse(searchParams);
    const filter = parsed.success ? parsed.data : undefined;

    const inquiries = await listInquiries({ ...filter, parkSlug: "nedelovoy" });
    return apiResponse(inquiries);
  } catch (error) {
    console.error("[Nedelovoy] List inquiries error:", error);
    return apiServerError();
  }
}
