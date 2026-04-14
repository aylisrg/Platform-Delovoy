"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

type ExpiringBatch = {
  batchId: string;
  skuId: string;
  skuName: string;
  skuUnit: string;
  remainingQty: number;
  expiresAt: string;
  daysUntilExpiry: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function expiryColor(days: number): string {
  if (days <= 0) return "text-red-700 font-semibold";
  if (days <= 3) return "text-amber-700 font-semibold";
  return "text-yellow-700";
}

function expiryBadgeCls(days: number): string {
  if (days <= 0) return "bg-red-100 text-red-800";
  if (days <= 3) return "bg-amber-100 text-amber-800";
  return "bg-yellow-100 text-yellow-800";
}

function daysLabel(days: number): string {
  if (days <= 0) return "Истёк";
  if (days === 1) return "1 день";
  if (days < 5) return `${days} дня`;
  return `${days} дней`;
}

export default function ExpiringPage() {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [inputDays, setInputDays] = useState("7");
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiredLoading, setExpiredLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(
    (d: number) => {
      setLoading(true);
      setBanner(null);
      fetch(`/api/inventory/expiring?days=${d}`)
        .then((r) => r.json())
        .then((json: { success: boolean; data?: ExpiringBatch[] }) => {
          if (json.success && json.data) setBatches(json.data);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    load(days);
  }, [load, days]);

  function handleDaysChange() {
    const val = parseInt(inputDays, 10);
    if (!isNaN(val) && val > 0 && val <= 365) {
      setDays(val);
    }
  }

  async function handleWriteOffExpired() {
    setBanner(null);
    setExpiredLoading(true);
    try {
      const res = await fetch("/api/inventory/write-offs/expired", { method: "POST" });
      const json = await res.json() as {
        success: boolean;
        data?: { count: number };
        error?: { message?: string };
      };
      if (json.success) {
        const count = json.data?.count ?? 0;
        setBanner({
          type: "success",
          text:
            count > 0
              ? `Списано ${count} просроченных партий`
              : "Просроченных партий не найдено",
        });
        load(days);
        router.refresh();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setExpiredLoading(false);
    }
  }

  const expired = batches.filter((b) => b.daysUntilExpiry <= 0);
  const urgentSoon = batches.filter((b) => b.daysUntilExpiry > 0 && b.daysUntilExpiry <= 3);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Истечение срока</h1>
        <button
          onClick={handleWriteOffExpired}
          disabled={expiredLoading}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {expiredLoading ? "Списываем..." : "Списать все просроченные"}
        </button>
      </header>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/expiring"
                  ? "text-blue-600 border-blue-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-900 hover:border-zinc-300"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {banner && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              banner.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        {expired.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-red-800">
              {expired.length} {expired.length === 1 ? "партия" : "партий"} с истёкшим сроком
              годности — спишите немедленно.
            </p>
          </div>
        )}

        {urgentSoon.length > 0 && expired.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              {urgentSoon.length} {urgentSoon.length === 1 ? "партия истекает" : "партий истекают"}{" "}
              через ≤ 3 дня.
            </p>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-700">Показать истекающие за</label>
          <input
            type="number"
            value={inputDays}
            onChange={(e) => setInputDays(e.target.value)}
            onBlur={handleDaysChange}
            onKeyDown={(e) => e.key === "Enter" && handleDaysChange()}
            min={1}
            max={365}
            className="w-20 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-zinc-600">дней</span>
          <button
            onClick={handleDaysChange}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Применить
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">
              Истекающие партии (в течение {days} дней)
            </h2>
            <span className="text-sm text-zinc-400">{batches.length} партий</span>
          </div>

          {loading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : batches.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">
              Нет партий с истечением срока в течение {days} дней
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Остаток</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">
                      Дата истечения
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Осталось</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {batches.map((b) => (
                    <tr
                      key={b.batchId}
                      className={`hover:bg-zinc-50 ${
                        b.daysUntilExpiry <= 0 ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900">{b.skuName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                        {b.remainingQty} {b.skuUnit}
                      </td>
                      <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                        {formatDate(b.expiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${expiryBadgeCls(
                            b.daysUntilExpiry
                          )}`}
                        >
                          <span className={expiryColor(b.daysUntilExpiry)}>
                            {daysLabel(b.daysUntilExpiry)}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
