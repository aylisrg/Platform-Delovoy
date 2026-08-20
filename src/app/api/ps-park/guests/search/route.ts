import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { searchGuestsByPhone } from "@/modules/booking/guest-search";
import { guestSearchQuerySchema } from "@/modules/booking/validation";
import { rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/ps-park/guests/search?phone=... — автокомплит гостя по телефону
 * в quick-форме (#666). Гейт — доступ к модулю `ps-park`, НЕ к `clients`:
 * иначе автокомплит не работал бы для типичного MANAGER, у которого нет
 * отдельного назначения на CRM-раздел (AC-4).
 *
 * Рейт-лимит — defense-in-depth для debounced keystroke-эндпоинта, по
 * прецеденту `inventory/sku/search` (issue #674).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) return apiForbidden();
    const denied = await requireAdminSection(session, "ps-park");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated", session.user.id);
    if (rl) return rl;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = guestSearchQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const guests = await searchGuestsByPhone("ps-park", parsed.data.phone);
    return apiResponse(guests);
  } catch {
    return apiServerError();
  }
}
