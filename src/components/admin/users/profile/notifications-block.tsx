"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExplainEvent, ExplainStatus, StaffNotificationExplain } from "@/modules/notifications/explain";

/**
 * Блок «Уведомления» на странице сотрудника (US-C1/C2): по каждому событию
 * каталога — получает ли, по какому пути, каким каналом и что блокирует;
 * тумблер пишет ту же подписку, что Центр в Mini App (решение владельца №3).
 */

export const STATUS_LABELS: Record<ExplainStatus, string> = {
  RECEIVES: "Получает",
  BLOCKED: "Подписан, но не дойдёт",
  NOT_RECEIVING: "Не получает",
  NO_ACCESS: "Нет доступа к разделу",
};

const STATUS_TONE: Record<ExplainStatus, string> = {
  RECEIVES: "bg-emerald-50 text-emerald-700",
  BLOCKED: "bg-amber-50 text-amber-700",
  NOT_RECEIVING: "bg-zinc-100 text-zinc-600",
  NO_ACCESS: "bg-zinc-100 text-zinc-400",
};

const VIA_LABELS: Record<string, string> = {
  admin: "админка",
  matrix: "матрица",
  miniapp: "Mini App",
  system: "система",
};

function changedLine(event: ExplainEvent): string | null {
  if (!event.lastChange) return null;
  const at = new Date(event.lastChange.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const via = event.lastChange.via ? ` (${VIA_LABELS[event.lastChange.via] ?? event.lastChange.via})` : "";
  return `Изменено: ${event.lastChange.byName ?? "сотрудник"}, ${at}${via}`;
}

export function NotificationsBlock({ userId }: { userId: string }) {
  const [data, setData] = useState<StaffNotificationExplain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // A late answer for a previous load (or another user) must not win.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch(`/api/users/${userId}/notifications`);
      const body = await res.json();
      if (seq !== requestSeq.current) return;
      if (body.success) {
        setData(body.data);
        setError(null);
      } else {
        setError(body.error?.message ?? "Не удалось загрузить уведомления");
      }
    } catch {
      if (seq === requestSeq.current) setError("Ошибка сети");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(event: ExplainEvent) {
    if (!data || saving) return;
    const next = !event.toggle.enabled;
    setSaving(event.eventType);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: event.eventType, enabled: next, source: "profile" }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.error?.message ?? "Не удалось сохранить");
        return;
      }
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(null);
    }
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900">Уведомления</h2>
        <p className="mt-2 text-sm text-zinc-400">{error ?? "Загрузка..."}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">Уведомления</h2>
        <p className="text-xs text-zinc-500">
          Каналы:{" "}
          {data.channels.length === 0
            ? "нет канала доставки"
            : data.channels.map((c) => `${c.order}. ${c.label}${c.deliverable ? "" : ` (${c.note ?? "недоступен"})`}`).join(" → ")}
        </p>
      </div>
      {data.globalNotes.length > 0 && (
        <p className="mt-1 text-xs text-amber-700">{data.globalNotes.map((n) => n.label).join(" · ")}</p>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 space-y-5">
        {data.categories.map((category) => (
          <div key={category.key} className={category.access.ok ? "" : "opacity-60"}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-zinc-800">{category.label}</h3>
              {!category.access.ok && <span className="text-xs text-zinc-500">{category.access.label}</span>}
            </div>
            {category.groupChat.map((g) => (
              <p key={g.moduleSlug} className="text-xs text-zinc-500">
                Общий чат раздела «{g.moduleLabel}» получает это событие: {g.receives ? "да" : "нет"}
              </p>
            ))}
            <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-100">
              {category.events.map((event) => (
                <li key={event.eventType} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-zinc-900">{event.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[event.status]}`}>
                        {STATUS_LABELS[event.status]}
                      </span>
                    </div>
                    {event.paths.length > 0 && (
                      <p className="mt-0.5 text-xs text-zinc-600">Путь: {event.paths.map((p) => p.label).join("; ")}</p>
                    )}
                    {event.deliveryChannels.length > 0 && (
                      <p className="text-xs text-zinc-500">Канал: {event.deliveryChannels.map((c) => c.label).join(" → ")}</p>
                    )}
                    {event.blockers.map((b) => (
                      <p key={b.code} className="text-xs text-amber-700">{b.label}</p>
                    ))}
                    {event.notes.map((n) => (
                      <p key={n.code} className="text-xs text-zinc-500">{n.label}</p>
                    ))}
                    {changedLine(event) && <p className="text-xs text-zinc-400">{changedLine(event)}</p>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={event.toggle.enabled}
                    aria-label={event.label}
                    disabled={!event.toggle.editable || saving !== null}
                    onClick={() => void toggle(event)}
                    className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${event.toggle.enabled ? "bg-emerald-500" : "bg-zinc-300"} disabled:opacity-40`}
                  >
                    <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${event.toggle.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-400">
        Сотрудник видит и может изменить эти настройки в Центре уведомлений Mini App. Каждое изменение записывается в журнал.
      </p>
    </section>
  );
}
