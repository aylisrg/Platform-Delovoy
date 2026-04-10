import { NextRequest } from "next/server";
import { apiResponse, apiError, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getInquiry, updateInquiry, RentalError } from "@/modules/rental/service";
import { updateInquirySchema } from "@/modules/rental/validation";

/**
 * GET /api/rental/inquiries/:id — admin only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const { id } = await params;
    const inquiry = await getInquiry(id);

    // Auto-mark as read on view
    if (!inquiry.isRead) {
      await updateInquiry(id, { isRead: true });
    }

    return apiResponse(inquiry);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message, 404);
    }
    return apiServerError();
  }
}

/**
 * PATCH /api/rental/inquiries/:id — admin only, update status/notes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateInquirySchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const inquiry = await updateInquiry(id, parsed.data);

    await logAudit(session!.user!.id!, "inquiry.update", "RentalInquiry", id, parsed.data);

    return apiResponse(inquiry);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message, 404);
    }
    return apiServerError();
  }
}
