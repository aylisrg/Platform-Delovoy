import { apiResponse, apiNotFound, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getClientDetail } from "@/modules/clients/service";

/**
 * GET /api/admin/clients/:id — detailed client profile.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "clients");
    if (denied) return denied;

    const { id } = await params;
    const client = await getClientDetail(id);

    if (!client) {
      return apiNotFound("Клиент не найден");
    }

    return apiResponse(client);
  } catch (error) {
    console.error("[Admin Clients] Detail error:", error);
    return apiServerError();
  }
}
