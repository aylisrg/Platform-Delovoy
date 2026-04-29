"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  publicId: string;
  avitoChatId: string;
  itemUrl?: string | null;
};

/**
 * Inline Avito reply form rendered on Task detail when the underlying task
 * came from Avito Messenger. Posts to /api/tasks/:publicId/avito/reply and
 * triggers `router.refresh()` on success so the new comment + event appear
 * in the task timeline.
 */
export function AvitoReplyForm({ publicId, avitoChatId, itemUrl }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!text.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${publicId}/avito/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: unknown }
        | { success: false; error: { code: string; message: string } }
        | null;

      if (!res.ok || !json || json.success === false) {
        const message =
          json && "error" in json && json.error?.message
            ? json.error.message
            : `Ошибка ${res.status}`;
        setError(message);
        return;
      }

      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-emerald-900">
          Ответить в Авито
        </h2>
        <span className="font-mono text-xs text-emerald-700">
          chat: {avitoChatId.slice(0, 12)}…
        </span>
      </header>
      {itemUrl && (
        <p className="mb-2 text-xs">
          <a
            href={itemUrl}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-800 underline"
          >
            Открыть объявление на Авито
          </a>
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          className="block w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm"
          placeholder="Ваш ответ клиенту в Авито Мессенджере..."
          disabled={loading}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-emerald-700">{text.length}/2000</span>
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Отправляем…" : "Отправить в Авито"}
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
