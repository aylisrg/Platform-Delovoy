import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { getSubscription } from "@/modules/subscriptions/service";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Активен",
  EXPIRED: "Истёк",
  DEPLETED: "Исчерпан",
  CANCELLED: "Отменён",
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  EXPIRED: "bg-zinc-200 text-zinc-700",
  DEPLETED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const TX_TYPE_LABEL: Record<string, string> = {
  CHARGE: "Списание (сессия)",
  REFUND: "Возврат",
  MANUAL_TOPUP: "Пополнение",
  MANUAL_DEDUCT: "Списание (ручное)",
};

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (!hasRole(session.user, "MANAGER")) redirect("/admin/forbidden");

  const { id } = await params;
  const sub = await getSubscription(id);
  if (!sub) notFound();

  const usedHours = (
    Number(sub.totalHours) - Number(sub.remainingHours)
  ).toFixed(2);
  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      (Number(usedHours) / Number(sub.totalHours)) * 100
    )
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/ps-park/subscriptions"
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← Все абонементы
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            <Link
              href={`/admin/clients/${sub.userId}`}
              className="text-blue-600 hover:underline"
            >
              {sub.userName ?? sub.userId}
            </Link>
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {sub.userPhone ?? "Телефон не указан"} · с {new Date(sub.validFrom).toLocaleDateString("ru-RU")} по {new Date(sub.validTo).toLocaleDateString("ru-RU")}
          </p>
        </div>
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLOR[sub.status]}`}
        >
          {STATUS_LABEL[sub.status]}
        </span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs uppercase text-zinc-500">Куплено часов</p>
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">{sub.totalHours}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Остаток</p>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">{sub.remainingHours}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Использовано</p>
            <p className="text-2xl font-bold text-zinc-700 tabular-nums">{usedHours}</p>
          </div>
        </div>
        <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm text-zinc-600">
          <span>Цена покупки: <span className="font-semibold">{sub.pricePaid} ₽</span></span>
          {sub.notes && <span className="italic text-zinc-500">«{sub.notes}»</span>}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">
          Журнал транзакций ({sub.transactions.length})
        </h2>
        {sub.transactions.length === 0 ? (
          <p className="text-sm text-zinc-400">Транзакций нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500 uppercase border-b border-zinc-200">
                <tr>
                  <th className="px-3 py-2 text-left">Дата</th>
                  <th className="px-3 py-2 text-left">Операция</th>
                  <th className="px-3 py-2 text-right">Часы</th>
                  <th className="px-3 py-2 text-right">Остаток</th>
                  <th className="px-3 py-2 text-left">Кто</th>
                  <th className="px-3 py-2 text-left">Примечание</th>
                </tr>
              </thead>
              <tbody>
                {sub.transactions.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100">
                    <td className="px-3 py-2 text-zinc-500 text-xs">
                      {new Date(t.createdAt).toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-2">{TX_TYPE_LABEL[t.type] ?? t.type}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        Number(t.hoursDelta) >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {Number(t.hoursDelta) >= 0 ? "+" : ""}
                      {t.hoursDelta}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.balanceAfter}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{t.performedByName}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{t.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
