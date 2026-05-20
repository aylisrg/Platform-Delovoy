"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { AdminHeader } from "@/components/admin/header";
import { SEGMENT_LABELS } from "@/modules/notifications/cohorts/segments";
import { SEGMENT_KEYS } from "@/modules/notifications/cohorts/validation";

type SegmentKey = (typeof SEGMENT_KEYS)[number];

type PreviewData = {
  segmentKey: SegmentKey;
  label: string;
  total: number;
  sample: Array<{ id: string; name: string | null; email: string | null; phone: string | null }>;
};

type Campaign = {
  id: string;
  segmentKey: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  payload: { title: string; body: string };
};

export const dynamic = "force-dynamic";

export default function BroadcastPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPERADMIN";

  const [segmentKey, setSegmentKey] = useState<SegmentKey | "">("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ campaignId: string; total: number; sent: number; failed: number } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (key: SegmentKey) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/notifications/broadcast/preview?segment=${key}`);
      const json = await res.json();
      if (json.success) setPreview(json.data);
      else setError(json.error?.message ?? "Ошибка загрузки превью");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleSegmentChange = (key: SegmentKey | "") => {
    setSegmentKey(key);
    setPreview(null);
    if (key) loadPreview(key as SegmentKey);
  };

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const res = await fetch("/api/notifications/broadcast");
      const json = await res.json();
      if (json.success) setCampaigns(json.data);
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  const handleSend = async () => {
    if (!segmentKey || !title.trim() || !body.trim()) return;
    setError(null);
    setResult(null);
    setSending(true);
    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentKey,
          title: title.trim(),
          body: body.trim(),
          ctaLabel: ctaLabel.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        await loadCampaigns();
      } else {
        setError(json.error?.message ?? "Ошибка рассылки");
      }
    } catch {
      setError("Сеть недоступна");
    } finally {
      setSending(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <>
        <AdminHeader title="Рассылки" />
        <div className="p-8 text-sm text-zinc-500">
          Только суперадмин может создавать рассылки.
        </div>
      </>
    );
  }

  return (
    <>
      <AdminHeader title="Рассылки" />
      <div className="space-y-6 p-8 max-w-3xl">
        {/* Segment picker */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-4">
            1. Выберите сегмент
          </h2>
          <div className="flex flex-wrap gap-2">
            {SEGMENT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleSegmentChange(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                  segmentKey === key
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500"
                }`}
              >
                {SEGMENT_LABELS[key]}
              </button>
            ))}
          </div>

          {previewLoading && (
            <p className="mt-3 text-sm text-zinc-400">Загружаем аудиторию…</p>
          )}

          {preview && (
            <div className="mt-4 rounded-lg bg-zinc-50 border border-zinc-200 p-4">
              <p className="text-sm font-medium text-zinc-900">
                {preview.label} — <span className="text-blue-600">{preview.total} пользователей</span>
              </p>
              {preview.sample.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {preview.sample.slice(0, 5).map((u) => (
                    <li key={u.id} className="text-xs text-zinc-500">
                      {u.name ?? "—"} · {u.email ?? u.phone ?? "no contact"}
                    </li>
                  ))}
                  {preview.total > 5 && (
                    <li className="text-xs text-zinc-400">… и ещё {preview.total - 5}</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Message composer */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-4">
            2. Сообщение
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Заголовок <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Новые часы работы в праздники"
                maxLength={200}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Текст <span className="text-red-500">*</span>
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Уважаемые клиенты, сообщаем что в выходные…"
                maxLength={1000}
                rows={4}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Кнопка (необязательно)
                </label>
                <input
                  type="text"
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder="Подробнее"
                  maxLength={80}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  URL кнопки
                </label>
                <input
                  type="url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Send button */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !segmentKey || !title.trim() || !body.trim()}
            className="rounded-lg bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? "Отправляем…" : `Отправить${preview ? ` (${preview.total})` : ""}`}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <p className="font-medium text-emerald-900">Рассылка запущена</p>
            <p className="mt-1 text-emerald-800">
              Всего: {result.total} · Поставлено в очередь: {result.sent} · Пропущено: {result.failed}
            </p>
            <p className="mt-1 text-xs text-emerald-700">ID кампании: {result.campaignId}</p>
          </div>
        )}

        {/* Campaign history */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              История рассылок
            </h2>
            <button
              type="button"
              onClick={loadCampaigns}
              className="text-xs text-zinc-500 hover:text-zinc-700"
            >
              Обновить
            </button>
          </div>

          {campaignsLoading && <p className="text-sm text-zinc-400">Загружаем…</p>}

          {campaigns.length === 0 && !campaignsLoading && (
            <p className="text-sm text-zinc-400">
              Нет кампаний.{" "}
              <button type="button" onClick={loadCampaigns} className="underline text-zinc-500">
                Загрузить
              </button>
            </p>
          )}

          {campaigns.length > 0 && (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900 truncate">{c.payload.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {SEGMENT_LABELS[c.segmentKey as SegmentKey] ?? c.segmentKey} ·{" "}
                      {new Date(c.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-zinc-500">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 font-medium ${
                        c.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : c.status === "running"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {c.status === "completed" ? "готово" : c.status === "running" ? "в процессе" : c.status}
                    </span>
                    <p className="mt-1">
                      {c.sent}/{c.total}
                      {c.failed > 0 && (
                        <span className="ml-1 text-red-500">({c.failed} ошибок)</span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
