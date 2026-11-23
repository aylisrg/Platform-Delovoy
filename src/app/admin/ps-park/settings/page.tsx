import { ModuleSettings } from "@/components/admin/shared/module-settings";
import { PSParkTelegramChannelForm } from "@/components/admin/ps-park/telegram-channel-form";
import { OnlineBookingToggle } from "@/components/admin/ps-park/online-booking-toggle";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { DOCUMENT_KEYS, getCurrentVersion } from "@/modules/booking/offer";

export const dynamic = "force-dynamic";

const FIELDS = [
  { key: "openHour", label: "Час открытия", type: "number" as const, min: 0, max: 23 },
  { key: "closeHour", label: "Час закрытия", type: "number" as const, min: 0, max: 23 },
  { key: "minBookingHours", label: "Минимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
  { key: "slotRoundingMinutes", label: "Округление слота (минуты)", type: "number" as const, min: 1, max: 60 },
  { key: "sessionAlertMinutes", label: "Алерт за N минут до конца", type: "number" as const, min: 1, max: 60 },
  { key: "noShowThresholdMinutes", label: "Порог неявки (минут после начала)", type: "number" as const, min: 1, max: 1440 },
];

export default async function PSParkSettingsPage() {
  const [session, parkModule, offer] = await Promise.all([
    auth(),
    prisma.module.findUnique({ where: { slug: "ps-park" }, select: { config: true } }),
    getCurrentVersion(DOCUMENT_KEYS.psParkOffer),
  ]);
  const config = parkModule?.config as Record<string, unknown> | null;
  return (
    <div className="space-y-8">
      <ModuleSettings moduleSlug="ps-park" fields={FIELDS} />
      <div className="border-t border-zinc-200 pt-8">
        <OnlineBookingToggle
          initialEnabled={config?.onlineBookingEnabled === true}
          canEdit={session?.user.role === "SUPERADMIN"}
          offer={offer && { number: offer.number, slug: offer.slug, contentHash: offer.contentHash }}
        />
      </div>
      <div className="border-t border-zinc-200 pt-8">
        <PSParkTelegramChannelForm />
      </div>
    </div>
  );
}
