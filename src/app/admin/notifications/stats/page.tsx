import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { NotificationsTabs } from "@/components/admin/notifications/notifications-tabs";
import { StatsPage } from "@/components/admin/notifications/stats/stats-page";

/**
 * /admin/notifications/stats — статистика доставки и реакций (US-D1, D4).
 * SUPERADMIN only (AC-D1.1), even with the «Уведомления» section granted.
 */

export const dynamic = "force-dynamic";

const SELF = "/admin/notifications/stats";

export default async function NotificationStatsPage() {
  const session = await auth();
  if (!session?.user) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(SELF)}`);
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");

  return (
    <>
      <AdminHeader title="Статистика уведомлений" />
      <div className="space-y-6 p-4 lg:p-8">
        <NotificationsTabs active="stats" isSuperadmin />
        <StatsPage />
      </div>
    </>
  );
}
