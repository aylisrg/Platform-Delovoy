"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Assignee = { id: string; name: string | null; email: string | null };

type TaskDetailProps = {
  task: {
    id: string;
    publicId: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    type: string;
    labels: string[];
    dueDate: string | null;
    category: { id: string; name: string; slug: string } | null;
    assignee: Assignee | null;
    reporter: Assignee | null;
    externalOffice: { id: string; number: string; building: number | null; floor: number | null } | null;
    externalTenant: { id: string; companyName: string } | null;
    externalContact: Record<string, unknown> | null;
    comments: Array<{
      id: string;
      body: string;
      source: string;
      createdAt: string;
      author: Assignee | null;
      authorExternal: Record<string, unknown> | null;
    }>;
    events: Array<{
      id: string;
      kind: string;
      metadata: Record<string, unknown> | null;
      createdAt: string;
    }>;
  };
  assignees: Assignee[];
  canReassign: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  BACKLOG: "Бэклог",
  TODO: "К выполнению",
  IN_PROGRESS: "В работе",
  IN_REVIEW: "На проверке",
  BLOCKED: "Заблокировано",
  DONE: "Готово",
  CANCELLED: "Отменено",
};

export function TaskDetail({ task, assignees, canReassign }: TaskDetailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [commentBody, setCommentBody] = useState("");
  const [assignee, setAssignee] = useState(task.assignee?.id ?? "");
  const [status, setStatus] = useState(task.status);

  function updateStatus(newStatus: string) {
    setStatus(newStatus);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${task.publicId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        setStatus(task.status);
        alert("Не удалось обновить статус");
      } else {
        router.refresh();
      }
    });
  }

  function updateAssignee(newId: string) {
    setAssignee(newId);
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${task.publicId}/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: newId || null }),
      });
      if (!res.ok) {
        setAssignee(task.assignee?.id ?? "");
        alert("Не удалось обновить исполнителя");
      } else {
        router.refresh();
      }
    });
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const body = commentBody.trim();
    if (!body) return;
    const res = await fetch(`/api/tasks/${task.publicId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      alert("Не удалось отправить комментарий");
      return;
    }
    setCommentBody("");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="col-span-1 space-y-4 lg:col-span-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-zinc-400">{task.publicId}</span>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {task.type === "ISSUE" ? "Жалоба" : "Задача"}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">{task.title}</h1>
          {task.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">
              {task.description}
            </p>
          )}
          {task.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {task.labels.map((l) => (
                <span
                  key={l}
                  className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">Комментарии</h2>
          <div className="space-y-3">
            {task.comments.length === 0 && (
              <p className="text-sm text-zinc-500">Пока нет комментариев.</p>
            )}
            {task.comments.map((c) => {
              const authorLabel =
                c.author?.name ??
                c.author?.email ??
                (c.authorExternal?.name as string | undefined) ??
                (c.authorExternal?.email as string | undefined) ??
                "Внешний отправитель";
              return (
                <div key={c.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-700">{authorLabel}</span>
                    <span>· {new Date(c.createdAt).toLocaleString("ru-RU")}</span>
                    {c.source !== "WEB" && (
                      <span className="rounded bg-zinc-100 px-1 text-[10px] uppercase">
                        {c.source}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-zinc-800">{c.body}</p>
                </div>
              );
            })}
          </div>

          <form onSubmit={submitComment} className="mt-4">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="Ваш комментарий. Используйте @имя, чтобы упомянуть коллегу."
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!commentBody.trim()}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Отправить
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">История</h2>
          <ol className="space-y-1 text-xs text-zinc-500">
            {task.events.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="text-zinc-400">
                  {new Date(e.createdAt).toLocaleString("ru-RU")}
                </span>
                <span className="font-mono">{e.kind}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Статус
          </h3>
          <select
            value={status}
            disabled={pending}
            onChange={(e) => updateStatus(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Исполнитель
          </h3>
          {canReassign ? (
            <select
              value={assignee}
              disabled={pending}
              onChange={(e) => updateAssignee(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            >
              <option value="">Не назначен</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.email ?? a.id.slice(0, 6)}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-zinc-700">
              {task.assignee?.name ?? task.assignee?.email ?? "Не назначен"}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Детали
          </h3>
          <dl className="space-y-1">
            <Row label="Приоритет" value={task.priority} />
            {task.category && <Row label="Категория" value={task.category.name} />}
            {task.dueDate && (
              <Row
                label="Дедлайн"
                value={new Date(task.dueDate).toLocaleString("ru-RU")}
              />
            )}
            {task.reporter && (
              <Row
                label="Создал"
                value={task.reporter.name ?? task.reporter.email ?? "—"}
              />
            )}
            {task.externalTenant && (
              <Row label="Арендатор" value={task.externalTenant.companyName} />
            )}
            {task.externalOffice && (
              <Row
                label="Офис"
                value={`${task.externalOffice.number}${
                  task.externalOffice.building
                    ? ` (корпус ${task.externalOffice.building})`
                    : ""
                }`}
              />
            )}
            {task.externalContact?.email ? (
              <Row
                label="Контакт email"
                value={String(task.externalContact.email)}
              />
            ) : null}
            {task.externalContact?.phone ? (
              <Row
                label="Контакт телефон"
                value={String(task.externalContact.phone)}
              />
            ) : null}
          </dl>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-800">{value}</dd>
    </div>
  );
}
