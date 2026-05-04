"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientForm } from "./client-form";

// F4 ADR — admin guests directory. Search + pagination + inline create form
// (по образцу suppliers-list.tsx).

type ClientRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  bookingCount: number;
  totalSpent: number;
  lastActivityAt: string | null;
  createdAt: string;
};

type Props = {
  initialClients: ClientRow[];
  initialTotal: number;
  pageSize?: number;
};

const PAGE_SIZE = 50;

export function ClientsList({
  initialClients,
  initialTotal,
  pageSize = PAGE_SIZE,
}: Props) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>(initialClients);
  const [total, setTotal] = useState(initialTotal);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Refetch on search/page change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (debounced) params.set("search", debounced);
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));
      try {
        const res = await fetch(`/api/clients?${params.toString()}`);
        const json = await res.json();
        if (!cancelled && json.success) {
          setClients(json.data.clients);
          setTotal(json.data.total);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Skip initial render (server-rendered list already there)
    if (debounced || page > 1) load();
    return () => {
      cancelled = true;
    };
  }, [debounced, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function fmtMoney(n: number) {
    return n > 0 ? `${n.toLocaleString("ru-RU")} ₽` : "—";
  }

  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Поиск: имя, телефон, e-mail"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
        >
          {showForm ? "Закрыть" : "+ Создать гостя"}
        </button>
      </div>

      {showForm && (
        <ClientForm
          mode="create"
          onCancel={() => setShowForm(false)}
          onSuccess={(id) => {
            setShowForm(false);
            router.push(`/admin/clients/${id}`);
          }}
        />
      )}

      <div className="rounded-xl border border-zinc-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Имя</th>
              <th className="text-left px-4 py-2.5">Телефон</th>
              <th className="text-left px-4 py-2.5">E-mail</th>
              <th className="text-right px-4 py-2.5">Брони</th>
              <th className="text-right px-4 py-2.5">Потрачено</th>
              <th className="text-left px-4 py-2.5">Последняя активность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {clients.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={6}
                  className="text-center py-8 text-sm text-zinc-500"
                >
                  Гостей не найдено
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr
                key={c.id}
                onClick={() => router.push(`/admin/clients/${c.id}`)}
                className="hover:bg-zinc-50 cursor-pointer"
              >
                <td className="px-4 py-2.5 text-zinc-900">
                  {c.name ?? <span className="text-zinc-400">без имени</span>}
                </td>
                <td className="px-4 py-2.5 text-zinc-700 tabular-nums">
                  {c.phone ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-zinc-700">{c.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                  {c.bookingCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-zinc-900">
                  {fmtMoney(c.totalSpent)}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 text-xs">
                  {fmtDate(c.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          Всего гостей: <span className="font-semibold text-zinc-700">{total}</span>
          {loading && <span className="ml-3">Загрузка...</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-30"
          >
            ← Пред
          </button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-30"
          >
            След →
          </button>
        </div>
      </div>
    </div>
  );
}
