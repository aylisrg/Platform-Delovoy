import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { forbidden } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { getOrCreateSettings } from "@/modules/rental/notifications";
import { RentalNotificationSettingsForm } from "@/components/admin/rental/notification-settings-form";

export const dynamic = "force-dynamic";

export default async function NedelovoyNotificationSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  const ok = await hasAdminSectionAccess(session.user.id, "nedelovoy");
  if (!ok) forbidden();

  const settings = await getOrCreateSettings("nedelovoy");

  return (
    <>
      <AdminHeader title="НеДеловой — настройки уведомлений" />
      <div className="p-6 lg:p-8 max-w-4xl">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">
              Автоматические напоминания об оплате
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              Настройки планировщика писем. Письма уходят с адреса{" "}
              <b>{settings.fromEmail}</b>. Чтобы планировщик начал работать, нужно
              включить переключатель ниже.
            </p>
          </CardHeader>
          <CardContent>
            <RentalNotificationSettingsForm
              initial={{
                preReminderDays: settings.preReminderDays,
                escalationDaysAfter: settings.escalationDaysAfter,
                autoSendEnabled: settings.autoSendEnabled,
                fromEmail: settings.fromEmail,
                fromName: settings.fromName,
                bankDetails: settings.bankDetails ?? "",
                managerName: settings.managerName ?? "",
                managerPhone: settings.managerPhone ?? "",
                escalationTelegramEnabled: settings.escalationTelegramEnabled,
                escalationTelegramChatId: settings.escalationTelegramChatId ?? "",
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
