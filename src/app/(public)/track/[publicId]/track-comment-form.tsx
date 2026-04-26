"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrackCommentForm({ publicId }: { publicId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/track/${publicId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json();
      if (json?.success) {
        setBody("");
        router.refresh();
      } else {
        setError(json?.error?.message ?? "Не удалось отправить");
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        placeholder="Уточнение к обращению..."
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={loading || !body.trim()}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Отправка..." : "Отправить уточнение"}
      </button>
    </form>
  );
}
