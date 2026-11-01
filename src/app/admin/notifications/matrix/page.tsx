import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { MatrixTable } from "@/components/admin/notifications/matrix-table";
import { NotificationsTabs } from "@/components/admin/notifications/notifications-tabs";

export const dynamic = "force-dynamic";

/** «Сотрудники × события» (US-C4) — SUPERADMIN only (AC-C4.4). */
export default async function NotificationMatrixPage() {
  const session = await auth();
  if (!session?.user) redirect(`/auth/signin?callbackUrl=${encodeURIComponent("/admin/notifications/matrix")}`);
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");

  return (
    <>
      <AdminHeader title="Кто что получает" />
      <div className="space-y-6 p-4 sm:p-8">
        <NotificationsTabs active="matrix" isSuperadmin />
        <MatrixTable />
      </div>
    </>
  );
}
