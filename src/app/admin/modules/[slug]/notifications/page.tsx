import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { listEligibleRecipients } from "@/modules/notifications/recipients";
import { NotificationRecipientsForm } from "@/components/admin/modules/notification-recipients-form";

export const dynamic = "force-dynamic";

export default async function ModuleNotificationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") redirect("/admin/forbidden");

  const { slug } = await params;
  const recipients = await listEligibleRecipients(slug);

  return (
    <>
      <AdminHeader title={`Получатели уведомлений — ${slug}`} />
      <div className="p-8 max-w-2xl">
        <p className="text-sm text-zinc-500 mb-6">
          Выберите пользователей, которые будут получать Telegram-уведомления при
          входящих событиях этого модуля. Суперадмины получают уведомления всегда.
        </p>
        <NotificationRecipientsForm slug={slug} recipients={recipients} />
      </div>
    </>
  );
}
