import { apiResponse, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { clientFilterSchema } from "@/modules/clients/validation";
import { listClients } from "@/modules/clients/service";

/**
 * GET /api/admin/clients — list clients with aggregated data (spending, modules, activity).
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "clients");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const parsed = clientFilterSchema.safeParse(
      Object.fromEntries(searchParams)
    );

    const filter = parsed.success ? parsed.data : {};
    const result = await listClients(filter);

    return apiResponse(result.clients, { total: result.total });
  } catch (error) {
    console.error("[Admin Clients] List error:", error);
    return apiServerError();
  }
}
