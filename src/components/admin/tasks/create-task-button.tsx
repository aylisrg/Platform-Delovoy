"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Assignee = { id: string; name: string | null; email: string | null };
type Category = { id: string; slug: string; name: string };

export function CreateTaskButton({
  categories,
  assignees,
}: {
  categories: Category[];
  assignees: Assignee[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM",
    categoryId: "",
    assigneeUserId: "",
    dueDate: "",
    labels: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          priority: form.priority,
          categoryId: form.categoryId || undefined,
          assigneeUserId: form.assigneeUserId || undefined,
          dueDate: form.dueDate || undefined,
          labels: form.labels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          type: "INTERNAL",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message ?? "Не удалось создать задачу");
      }
      setOpen(false);
      setForm({
        title: "",
        description: "",
        priority: "MEDIUM",
        categoryId: "",
        assigneeUserId: "",
        dueDate: "",
        labels: "",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Новая задача
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="w-full max-w-lg space-y-3 rounded-lg bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-semibold">Новая задача</h3>
            <Field label="Заголовок *">
              <input
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Описание">
              <textarea
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full resize-y rounded border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Приоритет">
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="LOW">Низкий</option>
                  <option value="MEDIUM">Обычный</option>
                  <option value="HIGH">Высокий</option>
                  <option value="URGENT">Срочно</option>
                </select>
              </Field>
              <Field label="Категория">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Исполнитель">
                <select
                  value={form.assigneeUserId}
                  onChange={(e) => setForm((f) => ({ ...f, assigneeUserId: e.target.value }))}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Авто по категории</option>
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.email ?? a.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Дедлайн">
                <input
                  type="datetime-local"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            <Field label="Лейблы (через запятую)">
              <input
                value={form.labels}
                onChange={(e) => setForm((f) => ({ ...f, labels: e.target.value }))}
                className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                placeholder="bug, frontend"
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={busy || !form.title.trim()}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {busy ? "…" : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  );
}
