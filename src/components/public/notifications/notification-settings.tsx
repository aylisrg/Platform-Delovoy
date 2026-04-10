"use client";

import { useState, useEffect } from "react";

type Channel = "AUTO" | "TELEGRAM" | "WHATSAPP" | "EMAIL" | "VK";

const channelLabels: Record<Channel, string> = {
  AUTO: "Автоматически",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  VK: "VK Мессенджер",
};

interface Preference {
  preferredChannel: Channel;
  enableBooking: boolean;
  enableOrder: boolean;
  enableReminder: boolean;
}

export function NotificationSettings() {
  const [preference, setPreference] = useState<Preference>({
    preferredChannel: "AUTO",
    enableBooking: true,
    enableOrder: true,
    enableReminder: true,
  });
  const [availableChannels, setAvailableChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/notifications/preferences")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setPreference(data.data.preference);
          setAvailableChannels(data.data.availableChannels);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preference),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Channel selection */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Канал уведомлений
        </label>
        <select
          value={preference.preferredChannel}
          onChange={(e) =>
            setPreference((p) => ({
              ...p,
              preferredChannel: e.target.value as Channel,
            }))
          }
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="AUTO">
            Автоматически (по способу регистрации)
          </option>
          {availableChannels.map((ch) => (
            <option key={ch} value={ch}>
              {channelLabels[ch]}
            </option>
          ))}
        </select>
        {availableChannels.length > 0 && (
          <p className="mt-1.5 text-xs text-zinc-400">
            Доступные каналы: {availableChannels.map((c) => channelLabels[c]).join(", ")}
          </p>
        )}
      </div>

      {/* Category toggles */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-3">
          Категории уведомлений
        </label>
        <div className="space-y-2">
          {[
            { key: "enableBooking" as const, label: "Бронирования", desc: "Подтверждения и отмены бронирований беседок и PS Park" },
            { key: "enableOrder" as const, label: "Заказы", desc: "Статус заказов в кафе (готовится, готов, доставлен)" },
            { key: "enableReminder" as const, label: "Напоминания", desc: "Напоминания за 1 час до бронирования" },
          ].map((item) => (
            <label
              key={item.key}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                preference[item.key]
                  ? "border-blue-200 bg-blue-50"
                  : "border-zinc-200 bg-white"
              }`}
            >
              <input
                type="checkbox"
                checked={preference[item.key]}
                onChange={(e) =>
                  setPreference((p) => ({ ...p, [item.key]: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-zinc-900">
                  {item.label}
                </span>
                <p className="text-xs text-zinc-500">{item.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
        {saved && (
          <span className="text-sm text-green-600">Сохранено</span>
        )}
      </div>
    </div>
  );
}
