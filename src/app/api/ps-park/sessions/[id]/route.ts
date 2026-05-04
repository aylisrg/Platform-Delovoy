import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getSessionDetail } from "@/modules/ps-park/service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await rateLimit(request, "authenticated");
    if (limited) return limited;

    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const { id } = await params;
    const detail = await getSessionDetail(id);
    if (!detail) return apiNotFound("Сессия не найдена");
    return apiResponse(detail);
  } catch {
    return apiServerError();
  }
}
