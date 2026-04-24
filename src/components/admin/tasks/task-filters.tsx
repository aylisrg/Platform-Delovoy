"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

type Option = { id: string; name: string | null; email?: string | null };

export function TaskFilters({
  categories,
  assignees,
}: {
  categories: Array<{ id: string; slug: string; name: string }>;
  assignees: Option[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  function update(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/admin/tasks?${params.toString()}`);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    update("q", q);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={submitSearch} className="flex items-center gap-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск…"
          className="w-48 rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          🔎
        </button>
      </form>
      <select
        value={sp.get("status") ?? ""}
        onChange={(e) => update("status", e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">Все статусы</option>
        <option value="BACKLOG">Бэклог</option>
        <option value="TODO">К выполнению</option>
        <option value="IN_PROGRESS">В работе</option>
        <option value="IN_REVIEW">На проверке</option>
        <option value="BLOCKED">Заблокировано</option>
        <option value="DONE">Готово</option>
      </select>
      <select
        value={sp.get("priority") ?? ""}
        onChange={(e) => update("priority", e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">Все приоритеты</option>
        <option value="LOW">Низкий</option>
        <option value="MEDIUM">Обычный</option>
        <option value="HIGH">Высокий</option>
        <option value="URGENT">Срочно</option>
      </select>
      {(sp.get("tab") === "issues" || sp.get("type") === "ISSUE") && (
        <select
          value={sp.get("categoryId") ?? ""}
          onChange={(e) => update("categoryId", e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={sp.get("assigneeUserId") ?? ""}
        onChange={(e) => update("assigneeUserId", e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">Все исполнители</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.email ?? a.id.slice(0, 6)}
          </option>
        ))}
      </select>
    </div>
  );
}
