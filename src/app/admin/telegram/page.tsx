import { AdminHeader } from "@/components/admin/header";
import { TelegramSettings } from "@/components/admin/telegram/telegram-settings";

export const dynamic = "force-dynamic";

export default function TelegramPage() {
  return (
    <>
      <AdminHeader title="Telegram" />
      <div className="p-8">
        <TelegramSettings />
      </div>
    </>
  );
}
