"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/admin/header";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

type FeedbackItem = {
  id: string;
  type: "BUG" | "SUGGESTION";
  description: string;
  pageUrl: string;
  isUrgent: boolean;
  status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  createdAt: string;
  user: { id: string; name: string | null; email: string | null };
};

type Stats = {
  totalNew: number;
  totalUrgentNew: number;
  totalInProgress: number;
  totalResolved: number;
  totalRejected: number;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новое",
  IN_PROGRESS: "В работе",
  RESOLVED: "Выполнено",
  REJECTED: "Отклонено",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-yellow-100 text-yellow-700",
  RESOLVED: "bg-green-100 text-green-700",
  REJECTED: "bg-zinc-100 text-zinc-500",
};

const TYPE_LABELS: Record<string, string> = {
  BUG: "Ошибка",
  SUGGESTION: "Предложение",
};

export default function FeedbackAdminPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterUrgent, setFilterUrgent] = useState<string>("");

  const perPage = 20;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    if (filterStatus) params.set("status", filterStatus);
    if (filterType) params.set("type", filterType);
    if (filterUrgent) params.set("isUrgent", filterUrgent);

    try {
      const res = await fetch(`/api/feedback?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setTotal(data.meta?.total ?? 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterType, filterUrgent]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback/stats");
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <>
      <AdminHeader title="Обратная связь" />

      <div className="p-8 space-y-6">
        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard label="Новые" value={stats.totalNew} color="text-blue-600" />
            <StatCard label="Срочные" value={stats.totalUrgentNew} color="text-red-600" />
            <StatCard label="В работе" value={stats.totalInProgress} color="text-yellow-600" />
            <StatCard label="Выполнено" value={stats.totalResolved} color="text-green-600" />
            <StatCard label="Отклонено" value={stats.totalRejected} color="text-zinc-500" />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            <option value="">Все статусы</option>
            <option value="NEW">Новые</option>
            <option value="IN_PROGRESS">В работе</option>
            <option value="RESOLVED">Выполнено</option>
            <option value="REJECTED">Отклонено</option>
          </select>

          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            <option value="">Все типы</option>
            <option value="BUG">Ошибки</option>
            <option value="SUGGESTION">Предложения</option>
          </select>

          <select
            value={filterUrgent}
            onChange={(e) => { setFilterUrgent(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            <option value="">Все</option>
            <option value="true">Только срочные</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-400">
              Обращений пока нет
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="px-4 py-3 font-medium text-zinc-500 w-8"></th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Тип</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Описание</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Пользователь</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Статус</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-zinc-50 transition-colors hover:bg-zinc-50 ${
                      item.isUrgent && item.status === "NEW" ? "bg-red-50/50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      {item.isUrgent && (
                        <span title="СРОЧНО" className="text-red-500">!</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        item.type === "BUG" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {TYPE_LABELS[item.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <Link
                        href={`/admin/feedback/${item.id}`}
                        className="text-zinc-900 hover:text-blue-600 hover:underline"
                      >
                        {item.description.length > 100
                          ? item.description.slice(0, 100) + "..."
                          : item.description}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {item.user.name || item.user.email || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                      {formatDateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">
              {total} обращений
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-50 hover:bg-zinc-50"
              >
                Назад
              </button>
              <span className="flex items-center px-3 text-sm text-zinc-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-50 hover:bg-zinc-50"
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
