"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Переключатель публичной брони беседок с сайта. Пишет
 * `Module.config.publicBookingEnabled` через общий эндпоинт настроек модуля.
 * Админ-бронь (через панель) от флага не зависит.
 */
export function GazeboPublicBookingToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/gazebos/settings");
        const json = await res.json();
        if (json.success) {
          setEnabled(json.data?.publicBookingEnabled !== false);
        }
      } catch {
        setError("Не удалось загрузить настройки");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setMessage(null);
    setError(null);
    const prev = enabled;
    setEnabled(next);
    try {
      const res = await fetch("/api/gazebos/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicBookingEnabled: next }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message ?? "Ошибка сохранения");
      }
      setMessage(
        next
          ? "Публичная бронь включена"
          : "Публичная бронь отключена — на сайте показывается телефон"
      );
    } catch (err) {
      setEnabled(prev);
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-sm text-zinc-400 animate-pulse">Загрузка…</div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">
          Бронирование с сайта
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Временно закройте онлайн-бронь беседок на публичном сайте. Бронь через
          админ-панель продолжит работать.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-zinc-900">
            {enabled ? "Публичная бронь включена" : "Публичная бронь отключена"}
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            {enabled
              ? "Клиенты могут бронировать беседки онлайн на /gazebos."
              : "На /gazebos вместо формы показывается предложение позвонить."}
          </p>
        </div>
        <Button
          type="button"
          variant={enabled ? "danger" : "primary"}
          disabled={saving}
          onClick={() => save(!enabled)}
        >
          {saving ? "…" : enabled ? "Отключить" : "Включить"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  );
}
