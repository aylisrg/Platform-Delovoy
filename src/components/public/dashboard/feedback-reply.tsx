"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export function FeedbackReply({ feedbackId }: { feedbackId: string }) {
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !text.trim()) return;
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          const response = await fetch(`/api/feedback/${feedbackId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.trim() }),
          });
          const result = await response.json();
          if (!response.ok || !result.success)
            throw new Error(
              result.error?.message ?? "Не удалось отправить ответ",
            );
          setText("");
          setSaved(true);
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Не удалось отправить ответ",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm font-medium" htmlFor={id}>
        Дополнить обращение
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        required
        maxLength={5000}
        rows={3}
        disabled={busy}
        className="block w-full min-w-0 rounded-xl border border-zinc-300 p-3 text-sm focus-visible:outline-blue-600"
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          Ответ отправлен
        </p>
      )}
      <button
        disabled={busy || !text.trim()}
        className="min-h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Отправляем…" : "Отправить ответ"}
      </button>
    </form>
  );
}
