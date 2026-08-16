import { prisma } from "@/lib/db";

export type GuestMatch = { name: string; phone: string };

const MAX_RESULTS = 8;
const SCAN_LIMIT = 50;

/**
 * Автокомплит гостя по телефону в quick-форме (#666, AC-4: обязан работать
 * для MANAGER без назначения на модуль `clients`). Ищет по `Booking` того же
 * `moduleSlug`, а не по общему `User`/CRM — оператор видит только гостей,
 * реально бронировавших СВОЙ модуль, без доступа к кросс-модульным данным,
 * которые отдаёт `/api/admin/clients`.
 */
export async function searchGuestsByPhone(moduleSlug: string, phone: string): Promise<GuestMatch[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug,
      deletedAt: null,
      clientPhone: { contains: phone },
    },
    select: { clientName: true, clientPhone: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT,
  });

  const seen = new Map<string, GuestMatch>();
  for (const b of bookings) {
    if (!b.clientPhone || !b.clientName || seen.has(b.clientPhone)) continue;
    seen.set(b.clientPhone, { name: b.clientName, phone: b.clientPhone });
    if (seen.size >= MAX_RESULTS) break;
  }
  return [...seen.values()];
}
