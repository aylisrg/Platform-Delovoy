"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AvitoItemDto } from "@/lib/avito";

type Props = {
  items: AvitoItemDto[];
  isSuperadmin: boolean;
  moduleOptions: { slug: string; name: string }[];
};

const STATUS_LABEL: Record<AvitoItemDto["status"], string> = {
  ACTIVE: "Активно",
  ARCHIVED: "В архиве",
  BLOCKED: "Заблокировано",
  REMOVED: "Удалено",
};

const STATUS_STYLE: Record<AvitoItemDto["status"], string> = {
  ACTIVE: "bg-green-100 text-green-700",
  ARCHIVED: "bg-zinc-100 text-zinc-600",
  BLOCKED: "bg-red-100 text-red-700",
  REMOVED: "bg-zinc-100 text-zinc-400 line-through",
};

export function AvitoItemsTable({ items, isSuperadmin, moduleOptions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">Нет данных.</p>;
  }

  async function handleAssign(id: string, moduleSlug: string) {
    setError(null);
    const body = { moduleSlug: moduleSlug === "" ? null : moduleSlug };
    const res = await fetch(`/api/avito/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error?.message ?? "Не удалось сохранить");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleRefresh(id: string) {
    setRefreshingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/avito/items/${id}/refresh`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error?.message ?? "Не удалось обновить");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      {error && (
        <p className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
            <th className="pb-2 pr-4 font-medium">Объявление</th>
            <th className="pb-2 pr-4 font-medium">Статус</th>
            <th className="pb-2 pr-4 font-medium">Модуль</th>
            <th className="pb-2 pr-4 font-medium text-right">Просмотры (7д)</th>
            <th className="pb-2 pr-4 font-medium text-right">Контакты</th>
            <th className="pb-2 pr-4 font-medium text-right">Звонки</th>
            <th className="pb-2 font-medium text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-zinc-100">
              <td className="py-3 pr-4">
                <div className="flex flex-col gap-0.5">
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-zinc-900 hover:underline font-medium">
                      {it.title}
                    </a>
                  ) : (
                    <span className="text-zinc-900 font-medium">{it.title}</span>
                  )}
                  <span className="text-xs text-zinc-400">id: {it.avitoItemId}</span>
                </div>
              </td>
              <td className="py-3 pr-4">
                <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_STYLE[it.status]}`}>
                  {STATUS_LABEL[it.status]}
                </span>
              </td>
              <td className="py-3 pr-4">
                {isSuperadmin ? (
                  <select
                    value={it.moduleSlug ?? ""}
                    onChange={(e) => handleAssign(it.id, e.target.value)}
                    disabled={isPending}
                    className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white"
                  >
                    <option value="">— не привязано —</option>
                    {moduleOptions.map((m) => (
                      <option key={m.slug} value={m.slug}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-zinc-600">
                    {it.moduleSlug
                      ? moduleOptions.find((m) => m.slug === it.moduleSlug)?.name ?? it.moduleSlug
                      : "—"}
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right">
                <span className="font-medium text-zinc-900">{it.stats?.views.toLocaleString("ru-RU") ?? "—"}</span>
                {it.stats?.uniqViews !== undefined && (
                  <span className="block text-xs text-zinc-400">{it.stats.uniqViews.toLocaleString("ru-RU")} уник.</span>
                )}
              </td>
              <td className="py-3 pr-4 text-right">
                {it.stats?.contacts.toLocaleString("ru-RU") ?? "—"}
                {it.stats && it.stats.favorites > 0 && (
                  <span className="block text-xs text-zinc-400">{it.stats.favorites} в избранном</span>
                )}
              </td>
              <td className="py-3 pr-4 text-right">
                {it.stats?.calls.toLocaleString("ru-RU") ?? "—"}
                {it.stats && it.stats.missedCalls > 0 && (
                  <span className="block text-xs text-amber-700">{it.stats.missedCalls} пропущ.</span>
                )}
              </td>
              <td className="py-3 text-right">
                <button
                  onClick={() => handleRefresh(it.id)}
                  disabled={refreshingId === it.id || isPending}
                  className="text-xs px-2 py-1 rounded border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {refreshingId === it.id ? "..." : "Обновить"}
                </button>
                {it.stats?.stale && (
                  <p className="text-[10px] text-amber-700 mt-1">данные устарели</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
