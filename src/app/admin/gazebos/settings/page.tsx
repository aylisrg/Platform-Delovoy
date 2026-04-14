import { ModuleSettings } from "@/components/admin/shared/module-settings";

export const dynamic = "force-dynamic";

const FIELDS = [
  { key: "openHour", label: "Час открытия", type: "number" as const, min: 0, max: 23 },
  { key: "closeHour", label: "Час закрытия", type: "number" as const, min: 0, max: 23 },
  { key: "minBookingHours", label: "Минимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
  { key: "maxBookingHours", label: "Максимальная длительность (часы)", type: "number" as const, min: 1, max: 24 },
];

export default function GazebosSettingsPage() {
  return <ModuleSettings moduleSlug="gazebos" fields={FIELDS} />;
}
