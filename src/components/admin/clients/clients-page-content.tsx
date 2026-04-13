"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type ModuleUsage = {
  moduleSlug: string;
  moduleName: string;
  count: number;
  totalSpent: number;
};

type Client = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  vkId: string | null;
  createdAt: string;
  modulesUsed: ModuleUsage[];
  totalSpent: number;
  bookingCount: number;
  orderCount: number;
  lastActivityAt: string | null;
};

type ClientStats = {
  totalClients: number;
  newThisMonth: number;
  newThisWeek: number;
  activeThisMonth: number;
  topSpenders: Array<{ id: string; name: string | null; totalSpent: number }>;
  moduleBreakdown: Array<{
    moduleSlug: string;
    moduleName: string;
    clientCount: number;
  }>;
};

const MODULE_ICONS: Record<string, string> = {
  gazebos: "🏕",
  "ps-park": "🎮",
  cafe: "☕",
};

const MODULE_BADGE_VARIANT: Record<string, "success" | "info" | "warning"> = {
  gazebos: "success",
  "ps-park": "info",
  cafe: "warning",
};

function formatRubles(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return formatDate(iso);
}

export function ClientsPageContent() {
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<ClientStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(0);
  const perPage = 25;

  const fetchClients = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (moduleFilter) params.set("moduleSlug", moduleFilter);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      params.set("limit", String(perPage));
      params.set("offset", String(page * perPage));

      const res = await fetch(`/api/admin/clients?${params}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
        setTotal(data.meta?.total ?? 0);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [search, moduleFilter, sortBy, sortOrder, page]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/clients/stats");
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchClients();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchClients]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, moduleFilter, sortBy, sortOrder]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Всего клиентов" value={stats.totalClients} />
          <StatCard
            label="Новых за месяц"
            value={stats.newThisMonth}
            color="text-blue-600"
          />
          <StatCard
            label="Активных за месяц"
            value={stats.activeThisMonth}
            color="text-green-600"
          />
          <StatCard
            label="Новых за неделю"
            value={stats.newThisWeek}
            color="text-purple-600"
          />
        </div>
      )}

      {/* Module breakdown */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          {stats.moduleBreakdown.map((m) => (
            <div
              key={m.moduleSlug}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <span className="text-2xl">{MODULE_ICONS[m.moduleSlug]}</span>
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {m.moduleName}
                </p>
                <p className="text-xs text-zinc-500">
                  {m.clientCount} клиентов
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, email, телефону..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 pl-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none"
        >
          <option value="">Все модули</option>
          <option value="gazebos">Барбекю Парк</option>
          <option value="ps-park">Плей Парк</option>
          <option value="cafe">Кафе</option>
        </select>

        <select
          value={`${sortBy}:${sortOrder}`}
          onChange={(e) => {
            const [s, o] = e.target.value.split(":");
            setSortBy(s);
            setSortOrder(o);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none"
        >
          <option value="createdAt:desc">Сначала новые</option>
          <option value="createdAt:asc">Сначала старые</option>
          <option value="totalSpent:desc">По тратам (макс)</option>
          <option value="totalSpent:asc">По тратам (мин)</option>
          <option value="lastActivity:desc">Последняя активность</option>
          <option value="name:asc">По имени А-Я</option>
        </select>
      </div>

      {/* Clients table */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h2 className="font-semibold text-zinc-900">
            Клиенты
            {total > 0 && (
              <span className="ml-2 text-sm font-normal text-zinc-400">
                {total}
              </span>
            )}
          </h2>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">
              Загрузка...
            </div>
          ) : clients.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">
              {search || moduleFilter
                ? "Ничего не найдено"
                : "Нет клиентов"}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-zinc-500">
                  <th className="px-6 py-3 font-medium">Клиент</th>
                  <th className="px-6 py-3 font-medium">Контакты</th>
                  <th className="px-6 py-3 font-medium">Модули</th>
                  <th className="px-6 py-3 font-medium">Потрачено</th>
                  <th className="px-6 py-3 font-medium">Активность</th>
                  <th className="px-6 py-3 font-medium">Регистрация</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    className="hover:bg-zinc-50/50 transition-colors"
                  >
                    <td className="px-6 py-3">
                      <Link
                        href={`/admin/clients/${client.id}`}
                        className="flex items-center gap-3 group"
                      >
                        {client.image ? (
                          <img
                            src={client.image}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600">
                            {(client.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-zinc-900 group-hover:text-blue-600 transition-colors">
                          {client.name || "Без имени"}
                        </span>
                      </Link>
                    </td>

                    <td className="px-6 py-3">
                      <div className="space-y-0.5">
                        {client.email && (
                          <div className="text-zinc-600">{client.email}</div>
                        )}
                        {client.phone && (
                          <div className="text-zinc-400 text-xs">
                            {client.phone}
                          </div>
                        )}
                        {client.telegramId && (
                          <div className="text-zinc-400 text-xs">
                            TG: {client.telegramId}
                          </div>
                        )}
                        {!client.email &&
                          !client.phone &&
                          !client.telegramId && (
                            <span className="text-zinc-300">—</span>
                          )}
                      </div>
                    </td>

                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {client.modulesUsed.length === 0 ? (
                          <span className="text-zinc-300 text-xs">
                            Нет активности
                          </span>
                        ) : (
                          client.modulesUsed.map((m) => (
                            <Badge
                              key={m.moduleSlug}
                              variant={
                                MODULE_BADGE_VARIANT[m.moduleSlug] || "default"
                              }
                            >
                              {MODULE_ICONS[m.moduleSlug]} {m.moduleName} (
                              {m.count})
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-3">
                      <span
                        className={`font-medium ${client.totalSpent > 0 ? "text-zinc-900" : "text-zinc-300"}`}
                      >
                        {client.totalSpent > 0
                          ? formatRubles(client.totalSpent)
                          : "—"}
                      </span>
                    </td>

                    <td className="px-6 py-3 text-zinc-400">
                      {client.lastActivityAt
                        ? formatRelativeDate(client.lastActivityAt)
                        : "—"}
                    </td>

                    <td className="px-6 py-3 text-zinc-400">
                      {formatDate(client.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-3">
            <p className="text-xs text-zinc-400">
              Показано {page * perPage + 1}–
              {Math.min((page + 1) * perPage, total)} из {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Назад
              </button>
              <button
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top spenders */}
      {stats && stats.topSpenders.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 font-semibold text-zinc-900">
            Топ-5 по тратам
          </h3>
          <div className="space-y-3">
            {stats.topSpenders.map((s, i) => (
              <Link
                key={s.id}
                href={`/admin/clients/${s.id}`}
                className="flex items-center justify-between rounded-lg p-2 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-zinc-900">
                    {s.name || "Без имени"}
                  </span>
                </div>
                <span className="text-sm font-semibold text-zinc-900">
                  {formatRubles(s.totalSpent)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-zinc-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
