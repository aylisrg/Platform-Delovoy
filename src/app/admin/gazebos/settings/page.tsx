import { ModuleSettings } from "@/components/admin/shared/module-settings";
import { GazeboTelegramChannelForm } from "@/components/admin/gazebos/telegram-channel-form";

export const dynamic = "force-dynamic";

const FIELDS = [
  { key: "openHour", label: "Час открытия", type: "number" as const, min: 0, max: 23 },
  { key: "closeHour", label: "Час закрытия", type: "number" as const, min: 0, max: 23 },
  { key: "minBookingHours", label: "Минимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
  { key: "maxBookingHours", label: "Максимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
];

export default function GazebosSettingsPage() {
  return (
    <div className="space-y-8">
      <ModuleSettings moduleSlug="gazebos" fields={FIELDS} />
      <div className="border-t border-zinc-200 pt-8">
        <GazeboTelegramChannelForm />
      </div>
    </div>
  );
}
