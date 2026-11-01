import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { NotificationsTabs } from "@/components/admin/notifications/notifications-tabs";
import { NotificationRouting } from "@/components/admin/notifications/NotificationRouting";
import { WebPushOptIn } from "@/components/admin/notifications/WebPushOptIn";

export const dynamic = "force-dynamic";

export default async function NotificationsRoutingPage() {
  const session = await auth();
  const isSuperadmin = session?.user?.role === "SUPERADMIN";

  return (
    <>
      <AdminHeader title="Уведомления" />
      <div className="space-y-6 p-8">
        <NotificationsTabs active="routing" isSuperadmin={isSuperadmin} />
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
