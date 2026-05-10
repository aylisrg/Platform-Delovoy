import { AdminHeader } from "@/components/admin/header";
import { NotificationRouting } from "@/components/admin/notifications/NotificationRouting";
import { WebPushOptIn } from "@/components/admin/notifications/WebPushOptIn";

export const dynamic = "force-dynamic";

export default function NotificationsRoutingPage() {
  return (
    <>
      <AdminHeader title="Уведомления" />
      <div className="space-y-6 p-8">
        {/* Web Push opt-in (PR 3 / overdue-session-reminders).
            Видна только MANAGER/SUPERADMIN — компонент сам делает RBAC guard. */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Push-уведомления в этом браузере
          </h2>
          <WebPushOptIn />
        </section>
        <NotificationRouting />
      </div>
    </>
  );
}
