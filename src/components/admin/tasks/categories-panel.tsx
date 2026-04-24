"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Assignee = { id: string; name: string | null; email: string | null };

type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  keywords: string[];
  sortOrder: number;
  defaultAssignee: Assignee | null;
};

export function CategoriesPanel({
  categories,
  assignees,
  initialFallbackId,
}: {
  categories: Category[];
  assignees: Assignee[];
  initialFallbackId: string | null;
}) {
  const router = useRouter();
  const [fallbackId, setFallbackId] = useState<string>(initialFallbackId ?? "");
  const [fallbackSaving, setFallbackSaving] = useState(false);
  const [newCat, setNewCat] = useState({
    slug: "",
    name: "",
    keywords: "",
    defaultAssigneeUserId: "",
  });

  async function saveFallback(newId: string) {
    setFallbackId(newId);
    setFallbackSaving(true);
    try {
      await fetch("/api/tasks/settings/fallback-assignee", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: newId || null }),
      });
      router.refresh();
    } finally {
      setFallbackSaving(false);
    }
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/tasks/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: newCat.slug,
        name: newCat.name,
        keywords: newCat.keywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        defaultAssigneeUserId: newCat.defaultAssigneeUserId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data?.error?.message ?? "Ошибка создания");
      return;
    }
    setNewCat({ slug: "", name: "", keywords: "", defaultAssigneeUserId: "" });
    router.refresh();
  }

  async function updateAssignee(categoryId: string, userId: string) {
    await fetch(`/api/tasks/categories/${categoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAssigneeUserId: userId || null }),
    });
    router.refresh();
  }

  async function toggleActive(cat: Category) {
    await fetch(`/api/tasks/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !cat.isActive }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">
          Дежурный по умолчанию
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          Если категория задачи не определена (или у категории нет своего ответственного) — задача
          будет назначена на этого человека.
        </p>
        <select
          value={fallbackId}
          disabled={fallbackSaving}
          onChange={(e) => saveFallback(e.target.value)}
          className="w-full max-w-md rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          <option value="">— не назначен —</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.email ?? a.id.slice(0, 6)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">Категории</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-zinc-500">
              <th className="pb-2">Slug</th>
              <th className="pb-2">Название</th>
              <th className="pb-2">Ответственный</th>
              <th className="pb-2">Ключевые слова</th>
              <th className="pb-2">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {categories.map((c) => (
              <tr key={c.id} className={c.isActive ? "" : "opacity-50"}>
                <td className="py-2 font-mono text-xs">{c.slug}</td>
                <td className="py-2">{c.name}</td>
                <td className="py-2">
                  <select
                    value={c.defaultAssignee?.id ?? ""}
                    onChange={(e) => updateAssignee(c.id, e.target.value)}
                    className="rounded border border-zinc-300 px-1 py-1 text-xs"
                  >
                    <option value="">—</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? a.email ?? a.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-xs text-zinc-600">
                  {c.keywords.join(", ") || "—"}
                </td>
                <td className="py-2">
                  <button
                    onClick={() => toggleActive(c)}
                    className="rounded border border-zinc-200 px-2 py-1 text-xs"
                  >
                    {c.isActive ? "Отключить" : "Включить"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={createCategory}
        className="rounded-lg border border-zinc-200 bg-white p-5 space-y-3"
      >
        <h2 className="text-sm font-semibold text-zinc-700">Новая категория</h2>
        <div className="grid grid-cols-2 gap-3">
          <input
            required
            value={newCat.slug}
            onChange={(e) => setNewCat((v) => ({ ...v, slug: e.target.value }))}
            placeholder="slug (latin, no spaces)"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            required
            value={newCat.name}
            onChange={(e) => setNewCat((v) => ({ ...v, name: e.target.value }))}
            placeholder="Название"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newCat.keywords}
            onChange={(e) =>
              setNewCat((v) => ({ ...v, keywords: e.target.value }))
            }
            placeholder="ключевые слова через запятую"
            className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          <select
            value={newCat.defaultAssigneeUserId}
            onChange={(e) =>
              setNewCat((v) => ({ ...v, defaultAssigneeUserId: e.target.value }))
            }
            className="col-span-2 rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="">Ответственный — не назначен</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email ?? a.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
        >
          Добавить
        </button>
      </form>
    </div>
  );
}
