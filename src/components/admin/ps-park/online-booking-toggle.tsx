"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function OnlineBookingToggle({
  initialEnabled, canEdit, offer,
}: {
  initialEnabled: boolean;
  canEdit: boolean;
  offer: { number: number; slug: string; contentHash: string } | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ps-park/settings/online-booking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled, ...(!enabled && { offerHash: offer?.contentHash }) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error?.message ?? "Не удалось сохранить настройки");
      setEnabled(result.data.onlineBookingEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-zinc-900">Бронирование с сайта</h2>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="space-y-1">
          <p className="font-semibold" role="status">{enabled ? "Онлайн-бронь включена" : "Онлайн-бронь отключена"}</p>
          <p className="text-sm text-zinc-600">Брони из админки доступны при любом положении переключателя.</p>
          {offer ? (
            <a className="text-sm text-blue-700 underline" href={`/ps-park/oferta/${encodeURIComponent(offer.slug)}`}>
              Действующая оферта, редакция № {offer.number}
            </a>
          ) : <p className="text-sm text-zinc-600">Для включения требуется действующая оферта.</p>}
        </div>
        {canEdit && (
          <Button type="button" variant={enabled ? "danger" : "primary"} disabled={saving || (!enabled && !offer)} onClick={save}>
            {saving ? "Сохраняем…" : enabled ? "Отключить" : "Включить"}
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
