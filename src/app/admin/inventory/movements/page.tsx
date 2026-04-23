"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { formatDateTime } from "@/lib/format";

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

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  RECEIPT: "Приход",
  WRITE_OFF: "Списание",
  SALE: "Продажа",
  AUDIT_ADJUSTMENT: "Корректировка",
  INITIAL: "Начальный остаток",
  RETURN: "Возврат",
  TRANSFER: "Перемещение",
};

const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  RECEIPT: "bg-green-100 text-green-800",
  WRITE_OFF: "bg-red-100 text-red-800",
  SALE: "bg-blue-100 text-blue-800",
  AUDIT_ADJUSTMENT: "bg-orange-100 text-orange-800",
  INITIAL: "bg-zinc-100 text-zinc-700",
  RETURN: "bg-purple-100 text-purple-800",
  TRANSFER: "bg-cyan-100 text-cyan-800",
};

type SkuOption = {
  id: string;
  name: string;
  unit: string;
};

type MovementRow = {
  id: string;
  skuId: string;
  type: string;
  delta: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  sku: { name: string };
};

function formatDate(iso: string) {
  return formatDateTime(iso);
}

const MOVEMENT_TYPES = [
  "RECEIPT",
  "WRITE_OFF",
  "SALE",
  "AUDIT_ADJUSTMENT",
  "INITIAL",
  "RETURN",
  "TRANSFER",
];

export default function MovementsPage() {
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterSkuId, setFilterSkuId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 30;

  useEffect(() => {
    fetch("/api/inventory/sku")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SkuOption[] }) => {
        if (json.success && json.data) setSkus(json.data);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    (p: number) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(p), perPage: String(perPage) });
      if (filterSkuId) params.set("skuId", filterSkuId);
      if (filterType) params.set("type", filterType);
      if (filterDateFrom) params.set("dateFrom", filterDateFrom);
      if (filterDateTo) params.set("dateTo", filterDateTo);

      fetch(`/api/inventory/movements?${params}`)
        .then((r) => r.json())
        .then(
          (json: {
            success: boolean;
            data?: MovementRow[];
            meta?: { total: number; perPage: number };
          }) => {
            if (json.success && json.data) {
              setMovements(json.data);
              const total = json.meta?.total ?? 0;
              const pp = json.meta?.perPage ?? perPage;
              setTotalPages(Math.max(1, Math.ceil(total / pp)));
            }
          }
        )
        .catch(() => undefined)
        .finally(() => setLoading(false));
    },
    [filterSkuId, filterType, filterDateFrom, filterDateTo, perPage]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  function handleFilter() {
    setPage(1);
    load(1);
  }

  function handleReset() {
    setFilterSkuId("");
    setFilterType("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Движения</h1>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/movements"
                  ? "text-blue-600 border-blue-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-900 hover:border-zinc-300"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {/* Filters */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Товар</label>
              <select
                value={filterSkuId}
                onChange={(e) => setFilterSkuId(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Все товары</option>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Тип</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Все типы</option>
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Дата от</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Дата до</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleFilter}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Применить
            </button>

            <button
              onClick={handleReset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Сбросить
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">Журнал движений</h2>
          </div>

          {loading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : movements.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">
              Нет движений по заданным фильтрам
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Дата</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                      <th className="px-4 py-3 text-center font-medium text-zinc-500">Тип</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Дельта</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Баланс</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Ссылка</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Примечание</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 text-zinc-600 whitespace-nowrap text-xs">
                          {formatDate(m.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium text-zinc-900">{m.sku.name}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              MOVEMENT_TYPE_COLORS[m.type] ?? "bg-zinc-100 text-zinc-600"
                            }`}
                          >
                            {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          <span className={m.delta >= 0 ? "text-green-700" : "text-red-700"}>
                            {m.delta >= 0 ? "+" : ""}
                            {m.delta}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                          {m.balanceAfter}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">
                          {m.referenceType && m.referenceId ? (
                            <span className="text-blue-600">{m.referenceType}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-xs truncate text-xs">
                          {m.note ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-100">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    ← Назад
                  </button>
                  <span className="text-sm text-zinc-500">
                    Стр. {page} из {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Вперёд →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
