import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";

export const dynamic = "force-dynamic";

const NAV_TABS = [
  { href: "/admin/inventory", label: "Остатки" },
  { href: "/admin/inventory/suppliers", label: "Поставщики" },
  { href: "/admin/inventory/receipts", label: "Приходы" },
  { href: "/admin/inventory/write-offs", label: "Списания" },
  { href: "/admin/inventory/expiring", label: "Истечение" },
  { href: "/admin/inventory/audits", label: "Инвентаризация" },
  { href: "/admin/inventory/movements", label: "Движения" },
  { href: "/admin/inventory/prices", label: "Цены" },
];

type DashboardData = {
  totalStockValueAtCost: number;
  totalPotentialRevenue: number;
  grossMarginPercent: number;
  stockStatus: {
    ok: number;
    low: number;
    out: number;
  };
  topSellers30Days: Array<{
    skuId: string;
    skuName: string;
    soldQty: number;
    revenue: number;
  }>;
  writeOffsQty30Days: number;
};

async function loadDashboard(): Promise<DashboardData | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/inventory/dashboard`, {
      cache: "no-store",
    });
    const json = await res.json() as { success: boolean; data?: DashboardData };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

function formatMoney(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

export default async function InventoryDashboardPage() {
  const data = await loadDashboard();

  return (
    <>
      <AdminHeader title="Склад — Аналитика (SUPERADMIN)" />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-zinc-500 border-b-2 border-transparent hover:text-zinc-900 hover:border-zinc-300 transition-colors -mb-px"
            >
              {tab.label}
            </Link>
          ))}
          <Link
            href="/admin/inventory/dashboard"
            className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-blue-600 border-b-2 border-blue-600 -mb-px"
          >
            Аналитика
          </Link>
        </nav>

        {!data ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-zinc-500">Нет доступа или ошибка загрузки данных</p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Стоимость склада
                </p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 tabular-nums">
                  {formatMoney(data.totalStockValueAtCost)}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">по закупочным ценам</p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Потенц. выручка
                </p>
                <p className="mt-1 text-2xl font-bold text-zinc-900 tabular-nums">
                  {formatMoney(data.totalPotentialRevenue)}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">по розничным ценам</p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Валовая маржа
                </p>
                <p
                  className={`mt-1 text-2xl font-bold tabular-nums ${
                    data.grossMarginPercent >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {data.grossMarginPercent.toFixed(1)}%
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Статус остатков
                </p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-green-700">В норме</span>
                    <span className="font-semibold tabular-nums">{data.stockStatus.ok}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-amber-700">Мало</span>
                    <span className="font-semibold tabular-nums">{data.stockStatus.low}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-red-700">Нет</span>
                    <span className="font-semibold tabular-nums">{data.stockStatus.out}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Write-offs KPI */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm flex items-center gap-4">
              <div className="rounded-lg bg-red-50 p-3">
                <svg
                  className="w-5 h-5 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-700">
                  Списано за последние 30 дней
                </p>
                <p className="text-2xl font-bold text-zinc-900 tabular-nums">
                  {data.writeOffsQty30Days} шт
                </p>
              </div>
            </div>

            {/* Top sellers */}
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="px-6 py-4 border-b border-zinc-100">
                <h2 className="text-base font-semibold text-zinc-900">
                  Топ-10 продаваемых товаров (30 дней)
                </h2>
              </div>

              {data.topSellers30Days.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-zinc-400">
                  Нет данных о продажах за последние 30 дней
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50">
                        <th className="px-4 py-3 text-left font-medium text-zinc-500">#</th>
                        <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                        <th className="px-4 py-3 text-right font-medium text-zinc-500">
                          Продано, шт
                        </th>
                        <th className="px-4 py-3 text-right font-medium text-zinc-500">
                          Выручка
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {data.topSellers30Days.slice(0, 10).map((item, idx) => (
                        <tr key={item.skuId} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 text-zinc-400 tabular-nums">{idx + 1}</td>
                          <td className="px-4 py-3 font-medium text-zinc-900">{item.skuName}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                            {item.soldQty}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-green-700 font-semibold">
                            {formatMoney(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
