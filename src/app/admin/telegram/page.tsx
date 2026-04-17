import { AdminHeader } from "@/components/admin/header";
import { TelegramSettings } from "@/components/admin/telegram/telegram-settings";
import { NotificationFlowMap } from "@/components/admin/notifications/NotificationFlowMap";

export const dynamic = "force-dynamic";

export default function TelegramPage() {
  return (
    <>
      <AdminHeader title="Telegram" />
      <div className="p-8 space-y-10">
        {/* Notification flow map */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-zinc-900">Карта уведомлений</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Визуальная схема: какие события куда и кому отправляет бот
            </p>
          </div>
          <NotificationFlowMap />
        </section>

        {/* Existing settings */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-zinc-900">Настройки бота</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Chat ID, токены, пользователи Telegram
            </p>
          </div>
          <TelegramSettings />
        </section>
      </div>
    </>
  );
}
