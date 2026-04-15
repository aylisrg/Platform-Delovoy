import { AdminHeader } from "@/components/admin/header";
import { ModuleTabs } from "@/components/admin/shared/module-tabs";

const TABS = [
  { label: "Расписание", href: "/admin/ps-park" },
  { label: "Ресурсы", href: "/admin/ps-park/resources" },
  { label: "Бронирования", href: "/admin/ps-park/bookings" },
  { label: "Аналитика", href: "/admin/ps-park/analytics" },
  { label: "Настройки", href: "/admin/ps-park/settings" },
];

export default function PSParkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AdminHeader title="Плей Парк" />
      <div className="p-8">
        <ModuleTabs tabs={TABS} />
        {children}
      </div>
    </>
  );
}
