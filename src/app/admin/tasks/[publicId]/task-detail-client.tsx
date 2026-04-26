"use client";
import { useState } from "react";

type Task = {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  priority: string;
  source: string;
  column: { id: string; name: string };
  assignees: { userId: string; role: string; name: string | null; email: string | null }[];
  labels: string[];
  createdAt: string;
};

type Event = {
  id: string;
  kind: string;
  actorName: string | null;
  createdAt: string;
  metadata: unknown;
};

type Comment = {
  id: string;
  body: string;
  authorUserId: string | null;
  visibleToReporter: boolean;
  createdAt: string;
};

export default function TaskDetailClient({
  task,
  events,
  comments: initialComments,
}: {
  task: Task;
  events: Event[];
  comments: Comment[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [newComment, setNewComment] = useState("");
  const [visibleToReporter, setVisibleToReporter] = useState(false);
  const [loading, setLoading] = useState(false);

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.publicId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newComment, visibleToReporter }),
      });
      const json = await res.json();
      if (json?.success) {
        setComments((c) => [...c, json.data]);
        setNewComment("");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <div>
        <header className="mb-4">
          <p className="font-mono text-sm text-gray-500">{task.publicId}</p>
          <h1 className="text-2xl font-semibold">{task.title}</h1>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-800">
              {task.column.name}
            </span>
            {task.priority !== "NONE" && (
              <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-800">
                {task.priority}
              </span>
            )}
            <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
              source: {task.source}
            </span>
          </div>
        </header>

        {task.description && (
          <section className="mb-6 whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-4 text-sm">
            {task.description}
          </section>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-lg font-medium">Комментарии</h2>
          <div className="space-y-2">
            {comments.map((c) => (
              <article
                key={c.id}
                className={`rounded-md border p-3 text-sm ${
                  c.visibleToReporter
                    ? "border-amber-200 bg-amber-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(c.createdAt).toLocaleString("ru-RU")}
                  {c.visibleToReporter ? " · видно репортёру" : ""}
                </p>
              </article>
            ))}
          </div>
          <form onSubmit={postComment} className="mt-3 space-y-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Новый комментарий..."
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={visibleToReporter}
                onChange={(e) => setVisibleToReporter(e.target.checked)}
              />
              Видно репортёру
            </label>
            <button
              type="submit"
              disabled={loading || !newComment.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Отправить
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-medium">История</h2>
          <ul className="space-y-1 text-xs text-gray-700">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-gray-500">
                  {new Date(e.createdAt).toLocaleString("ru-RU")}
                </span>{" "}
                — <strong>{e.kind}</strong>{" "}
                {e.actorName ? `(${e.actorName})` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="rounded-md border border-gray-200 bg-white p-4 text-sm">
        <h3 className="mb-2 font-medium">Участники</h3>
        <ul className="space-y-2">
          {task.assignees.map((a) => (
            <li key={a.userId} className="flex items-center justify-between">
              <span>{a.name ?? a.email ?? a.userId}</span>
              <span className="text-xs text-gray-500">{a.role}</span>
            </li>
          ))}
          {task.assignees.length === 0 && (
            <li className="text-xs text-gray-500">— нет назначенных —</li>
          )}
        </ul>
      </aside>
    </div>
  );
}
