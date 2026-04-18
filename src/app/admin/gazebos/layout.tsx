import { AdminHeader } from "@/components/admin/header";
import { ModuleTabs } from "@/components/admin/shared/module-tabs";

const TABS = [
  { label: "Расписание", href: "/admin/gazebos" },
  { label: "Ресурсы", href: "/admin/gazebos/resources" },
  { label: "Бронирования", href: "/admin/gazebos/bookings" },
  { label: "Аналитика", href: "/admin/gazebos/analytics" },
  { label: "Реклама", href: "/admin/gazebos/marketing" },
  { label: "Настройки", href: "/admin/gazebos/settings" },
];

export default function GazebosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AdminHeader title="Барбекю Парк" />
      <div className="p-4 lg:p-8">
        <ModuleTabs tabs={TABS} />
        {children}
      </div>
    </>
  );
}
