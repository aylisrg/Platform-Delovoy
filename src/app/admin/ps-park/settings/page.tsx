import { ModuleSettings } from "@/components/admin/shared/module-settings";
import { PSParkTelegramChannelForm } from "@/components/admin/ps-park/telegram-channel-form";

export const dynamic = "force-dynamic";

const FIELDS = [
  { key: "openHour", label: "Час открытия", type: "number" as const, min: 0, max: 23 },
  { key: "closeHour", label: "Час закрытия", type: "number" as const, min: 0, max: 23 },
  { key: "minBookingHours", label: "Минимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
  { key: "slotRoundingMinutes", label: "Округление слота (минуты)", type: "number" as const, min: 1, max: 60 },
  { key: "sessionAlertMinutes", label: "Алерт за N минут до конца", type: "number" as const, min: 1, max: 60 },
];

export default function PSParkSettingsPage() {
  return (
    <div className="space-y-8">
      <ModuleSettings moduleSlug="ps-park" fields={FIELDS} />
      <div className="border-t border-zinc-200 pt-8">
        <PSParkTelegramChannelForm />
      </div>
    </div>
  );
}
