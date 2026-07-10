import { auth } from "@/lib/auth";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { PaymentsTable } from "@/components/admin/payments/payments-table";

/**
 * Серверная обёртка страницы «Платежи»: собирает URL вебхука ЮKassa из
 * серверного окружения и отдаёт его ТОЛЬКО суперадмину — это единственный
 * канал доставки секрета владельцу (Telegram-уведомления деплоя могут быть
 * не настроены, доступа на VPS у владельца нет).
 */
export default async function AdminPaymentsPage() {
  const session = await auth();
  const isSuperadmin = session?.user?.role === "SUPERADMIN";

  const webhookSecret = process.env.YOOKASSA_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const webhookUrl =
    isSuperadmin && webhookSecret && appUrl
      ? `${appUrl}/api/payments/yookassa/webhook/${webhookSecret}`
      : null;

  return <PaymentsTable webhookUrl={webhookUrl} configured={isYooKassaConfigured()} />;
}
