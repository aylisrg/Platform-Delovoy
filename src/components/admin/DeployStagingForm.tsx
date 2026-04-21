"use client";

import { useState } from "react";

export function DeployStagingForm() {
  const [sha, setSha] = useState("");
  const [wipeDatabase, setWipeDatabase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    workflowUrl: string;
    sha: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const payload: Record<string, unknown> = { wipeDatabase };
      if (sha.trim()) payload.sha = sha.trim();

      const res = await fetch("/api/admin/deploy/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.message ?? `Сервер вернул ${res.status}`);
      }
      setResult({
        workflowUrl: body.data.workflowUrl,
        sha: body.data.sha ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5"
    >
      <div>
        <label className="block text-xs font-medium text-zinc-600 mb-1">
          Commit SHA (пусто = последний main)
        </label>
        <input
          type="text"
          value={sha}
          onChange={(e) => setSha(e.target.value)}
          placeholder="abc1234 или полный hash"
          className="w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={wipeDatabase}
          onChange={(e) => setWipeDatabase(e.target.checked)}
        />
        <span>
          Сбросить staging БД перед деплоем{" "}
          <span className="text-xs text-zinc-400">
            (удаляет всё в staging — нужно только если данные повреждены)
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {busy ? "Отправляется…" : "Deploy to Staging"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 space-y-1">
          <p>✅ Workflow запущен{result.sha ? ` для ${result.sha}` : ""}</p>
          <p>
            <a
              href={result.workflowUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Открыть историю runs →
            </a>
          </p>
        </div>
      )}
    </form>
  );
}
