import Link from "next/link";
import { forbidden } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusWidget } from "@/components/admin/status-widget";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { getCafeStats } from "@/modules/cafe/service";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERIODS = [
  { key: "today", label: "Сегодня" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
] as const;

const METHOD_LABELS: Record<string, string> = {
  sbp: "СБП",
  bank_card: "Банковская карта",
  yoo_money: "ЮMoney",
  sberbank: "SberPay",
  tinkoff_bank: "T-Pay",
  unknown: "Не определён",
};

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function resolveRange(period: string, dateFrom?: string, dateTo?: string) {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (period === "custom" && dateFrom && dateTo && dateRe.test(dateFrom) && dateRe.test(dateTo) && dateFrom <= dateTo) {
    return { period: "custom", dateFrom, dateTo };
  }
  const today = new Date();
  if (period === "today") {
    const d = isoDate(today);
    return { period: "today", dateFrom: d, dateTo: d };
  }
  if (period === "30d") {
    const from = new Date(today.getTime() - 29 * 86_400_000);
    return { period: "30d", dateFrom: isoDate(from), dateTo: isoDate(today) };
  }
  const from = new Date(today.getTime() - 6 * 86_400_000);
  return { period: "7d", dateFrom: isoDate(from), dateTo: isoDate(today) };
}

/** Горизонтальный бар: ширина от максимума в наборе (паттерн admin/analytics). */
function Bar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded bg-zinc-100">
      <div className={`h-2 rounded ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default async function CafeStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  const ok = await hasAdminSectionAccess(session.user.id, "cafe");
  if (!ok) forbidden();

  const raw = await searchParams;
  const range = resolveRange(raw.period ?? "7d", raw.dateFrom, raw.dateTo);
  const stats = await getCafeStats({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const maxDayRevenue = Math.max(...stats.byDay.map((d) => d.revenue), 0);
  const maxItemQty = Math.max(...stats.topItems.map((i) => i.quantity), 0);
  const maxCatRevenue = Math.max(...stats.byCategory.map((c) => c.revenue), 0);
  const methodTotal = stats.byPaymentMethod.reduce((s, m) => s + m.count, 0);
  const topItems = stats.topItems.slice(0, 15);

  const exportHref = `/api/cafe/stats/export?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`;

  return (
    <>
      <AdminHeader title="Кафе — статистика продаж" />
      <div className="p-8">
        {/* Period controls */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/admin/cafe/stats?period=${p.key}`}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  range.period === p.key
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="period" value="custom" />
            <input
              type="date"
              name="dateFrom"
              defaultValue={range.dateFrom}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <span className="text-zinc-400">—</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={range.dateTo}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
            >
              Показать
            </button>
          </form>
          <a
            href={exportHref}
            className="ml-auto rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            ⬇ Экспорт CSV
          </a>
        </div>

        <p className="mb-6 text-sm text-zinc-500">
          Период: {formatDate(new Date(range.dateFrom))} — {formatDate(new Date(range.dateTo))}.
          Учитываются оплаченные онлайн и выданные заказы (отменённые — нет).
        </p>

        {/* Totals */}
        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatusWidget
            title="Выручка"
            value={`${stats.revenue.toLocaleString("ru-RU")} ₽`}
            status="info"
          />
          <StatusWidget title="Заказов" value={stats.ordersCount} status="info" />
          <StatusWidget
            title="Средний чек"
            value={`${Math.round(stats.avgCheck).toLocaleString("ru-RU")} ₽`}
            status="info"
          />
          <StatusWidget
            title="Онлайн-оплат"
            value={stats.onlineCount}
            status="info"
            description={
              stats.ordersCount > 0
                ? `${Math.round((stats.onlineCount / stats.ordersCount) * 100)}% заказов, ${stats.onlineRevenue.toLocaleString("ru-RU")} ₽`
                : undefined
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Revenue by day */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-zinc-900">Выручка по дням</h2>
            </CardHeader>
            <CardContent>
              {stats.byDay.length === 0 ? (
                <p className="text-sm text-zinc-400">Продаж за период нет.</p>
              ) : (
                <div className="space-y-2">
                  {stats.byDay.map((day) => (
                    <div key={day.date} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 text-zinc-500">
                        {formatDate(new Date(day.date))}
                      </span>
                      <Bar value={day.revenue} max={maxDayRevenue} />
                      <span className="w-24 shrink-0 text-right font-medium text-zinc-900">
                        {day.revenue.toLocaleString("ru-RU")} ₽
                      </span>
                      <span className="w-14 shrink-0 text-right text-xs text-zinc-400">
                        {day.orders} зак.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment methods */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-zinc-900">Способы онлайн-оплаты</h2>
            </CardHeader>
            <CardContent>
              {stats.byPaymentMethod.length === 0 ? (
                <p className="text-sm text-zinc-400">Онлайн-оплат за период нет.</p>
              ) : (
                <div className="space-y-2">
                  {stats.byPaymentMethod.map((m) => (
                    <div key={m.method} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 text-zinc-600">
                        {METHOD_LABELS[m.method] ?? m.method}
                      </span>
                      <Bar value={m.count} max={methodTotal} color="bg-green-500" />
                      <span className="w-20 shrink-0 text-right font-medium text-zinc-900">
                        {m.count} ({methodTotal > 0 ? Math.round((m.count / methodTotal) * 100) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top items */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-zinc-900">
                Что покупают (топ-{topItems.length})
              </h2>
            </CardHeader>
            <CardContent>
              {topItems.length === 0 ? (
                <p className="text-sm text-zinc-400">Продаж за период нет.</p>
              ) : (
                <div className="space-y-2">
                  {topItems.map((item) => (
                    <div key={item.menuItemId} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 truncate text-zinc-600" title={item.name}>
                        {item.name}
                      </span>
                      <Bar value={item.quantity} max={maxItemQty} color="bg-amber-500" />
                      <span className="w-14 shrink-0 text-right font-medium text-zinc-900">
                        ×{item.quantity}
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs text-zinc-400">
                        {item.revenue.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Categories */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-zinc-900">По категориям</h2>
            </CardHeader>
            <CardContent>
              {stats.byCategory.length === 0 ? (
                <p className="text-sm text-zinc-400">Продаж за период нет.</p>
              ) : (
                <div className="space-y-2">
                  {stats.byCategory.map((cat) => (
                    <div key={cat.category} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 truncate text-zinc-600" title={cat.category}>
                        {cat.category}
                      </span>
                      <Bar value={cat.revenue} max={maxCatRevenue} color="bg-purple-500" />
                      <span className="w-24 shrink-0 text-right font-medium text-zinc-900">
                        {cat.revenue.toLocaleString("ru-RU")} ₽
                      </span>
                      <span className="w-14 shrink-0 text-right text-xs text-zinc-400">
                        ×{cat.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Link href="/admin/cafe" className="text-sm text-blue-600 hover:underline">
            ← Назад к управлению кафе
          </Link>
        </div>
      </div>
    </>
  );
}
