"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SubscriptionSummary, ListSubscriptionsResult } from "@/modules/subscriptions/types";
import { SubscriptionForm } from "./subscription-form";
import { formatDate as formatDateUnified } from "@/lib/format";

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

function formatDate(iso: string) {
  return formatDateUnified(iso);
}

export function SubscriptionsList() {
  const [items, setItems] = useState<SubscriptionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading-flag flip on filter change before debounce kicks in
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", "50");

    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/subscriptions?${params}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            const result = data.data as ListSubscriptionsResult;
            setItems(result.items);
            setTotal(result.total);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">
          Абонементы PS Park <span className="text-sm font-normal text-zinc-500">({total})</span>
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {showForm ? "Закрыть" : "+ Создать абонемент"}
        </button>
      </div>

      {showForm && <SubscriptionForm onSuccess={() => setShowForm(false)} />}

      <div className="flex gap-2 flex-wrap">
        {["", "ACTIVE", "EXPIRED", "DEPLETED", "CANCELLED"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {s ? STATUS_LABEL[s] : "Все"}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск гостя по имени или телефону..."
          className="ml-auto w-72 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Загрузка...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400">Абонементов нет</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Гость</th>
                <th className="px-4 py-2 text-right">Куплено</th>
                <th className="px-4 py-2 text-right">Остаток</th>
                <th className="px-4 py-2 text-left">Статус</th>
                <th className="px-4 py-2 text-left">Срок</th>
                <th className="px-4 py-2 text-right">Цена</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/ps-park/subscriptions/${s.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {s.userName ?? "—"}
                    </Link>
                    {s.userPhone && (
                      <div className="text-xs text-zinc-500">{s.userPhone}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.totalHours} ч</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">
                    {s.remainingHours} ч
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[s.status]}`}
                    >
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {formatDate(s.validFrom)} – {formatDate(s.validTo)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.pricePaid} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
