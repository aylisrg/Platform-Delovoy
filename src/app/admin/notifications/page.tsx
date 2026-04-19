import { AdminHeader } from "@/components/admin/header";
import { NotificationRouting } from "@/components/admin/notifications/NotificationRouting";

export const dynamic = "force-dynamic";

export default function NotificationsRoutingPage() {
  return (
    <>
      <AdminHeader title="Уведомления" />
      <div className="p-8">
        <NotificationRouting />
      </div>
    </>
  );
}
