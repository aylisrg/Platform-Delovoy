"use client";

import { useState, useEffect, useCallback, useId } from "react";

type Channel = "AUTO" | "TELEGRAM" | "EMAIL";
interface Preference {
  preferredChannel: Channel;
  enableBooking: boolean;
  enableOrder: boolean;
  enableReminder: boolean;
}
const labels: Record<Channel, string> = {
  AUTO: "Автоматически",
  TELEGRAM: "Telegram",
  EMAIL: "Email",
};
export function NotificationSettings() {
  const id = useId();
  const [preference, setPreference] = useState<Preference | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => {
    return fetch("/api/notifications/preferences")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(
            result.error?.message ?? "Не удалось загрузить настройки",
          );
        return result.data;
      })
      .then((data) => {
        setPreference(data.preference);
        setChannels(data.availableChannels);
      })
      .catch((err) =>
        setLoadError(
          err instanceof TypeError
            ? "Нет связи с сервером. Попробуйте ещё раз."
            : err instanceof Error
              ? err.message
              : "Не удалось загрузить настройки",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <p role="status" className="text-sm text-zinc-600">
        Загружаем настройки…
      </p>
    );
  if (loadError || !preference)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-700">
          {loadError || "Настройки недоступны"}
        </p>
        <button
          className="min-h-11 rounded-xl border border-zinc-300 px-4 text-sm"
          onClick={() => {
            setLoading(true);
            setLoadError("");
            void load();
          }}
        >
          Повторить загрузку настроек
        </button>
      </div>
    );
  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError("");
        setSaved(false);
        try {
          const response = await fetch("/api/notifications/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(preference),
          });
          const result = await response.json();
          if (!response.ok || !result.success)
            throw new Error(
              result.error?.message ?? "Не удалось сохранить настройки",
            );
          setPreference(result.data);
          setSaved(true);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Нет связи с сервером. Попробуйте ещё раз.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div>
        <label
          htmlFor={`${id}-channel`}
          className="mb-2 block text-sm font-medium"
        >
          Куда отправлять уведомления
        </label>
        <select
          id={`${id}-channel`}
          disabled={saving}
          value={preference.preferredChannel}
          onChange={(event) => {
            setPreference({
              ...preference,
              preferredChannel: event.target.value as Channel,
            });
            setSaved(false);
          }}
          className="w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-3 text-sm focus-visible:outline-blue-600"
        >
          <option value="AUTO">Выбирать автоматически</option>
          {channels.map((channel) => (
            <option key={channel} value={channel}>
              {labels[channel]}
            </option>
          ))}
          {preference.preferredChannel !== "AUTO" &&
            !channels.includes(preference.preferredChannel) && (
              <option value={preference.preferredChannel} disabled>
                {labels[preference.preferredChannel]} — контакт недоступен
              </option>
            )}
        </select>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          {channels.length
            ? `Доступны: ${channels.map((c) => labels[c]).join(", ")}. При автоматическом выборе используем доступный контакт.`
            : "Добавьте email или Telegram в профиле, чтобы получать уведомления."}
        </p>
      </div>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">О чём сообщать</legend>
        {(
          [
            ["enableBooking", "Бронирования", "Подтверждения и отмены визитов"],
            ["enableOrder", "Заказы кафе", "Приготовление и доставка заказов"],
            ["enableReminder", "Напоминания", "За час до начала бронирования"],
          ] as const
        ).map(([key, label, description]) => (
          <label
            key={key}
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-4"
          >
            <input
              type="checkbox"
              checked={preference[key]}
              onChange={(event) => {
                setPreference({ ...preference, [key]: event.target.checked });
                setSaved(false);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-blue-700"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="mt-1 block text-sm text-zinc-600">
                {description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-800">
          Настройки сохранены
        </p>
      )}
      <button
        disabled={saving}
        className="min-h-11 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Сохраняем…" : "Сохранить настройки"}
      </button>
    </form>
  );
}
