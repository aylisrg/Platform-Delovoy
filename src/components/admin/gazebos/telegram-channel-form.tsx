"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GAZEBO_CHANNEL_EVENTS } from "@/modules/gazebos/validation";

type ChannelState = {
  telegramChannelEnabled: boolean;
  telegramChannelName: string;
  telegramChannelId: string;
  telegramChannelEvents: string[];
};

const EMPTY: ChannelState = {
  telegramChannelEnabled: false,
  telegramChannelName: "",
  telegramChannelId: "",
  telegramChannelEvents: [],
};

export function GazeboTelegramChannelForm() {
  const [state, setState] = useState<ChannelState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/gazebos/settings");
        const json = await res.json();
        if (json.success) {
          const c = json.data as Partial<ChannelState>;
          setState({
            telegramChannelEnabled: c.telegramChannelEnabled ?? false,
            telegramChannelName: c.telegramChannelName ?? "",
            telegramChannelId: c.telegramChannelId ?? "",
            telegramChannelEvents: Array.isArray(c.telegramChannelEvents)
              ? c.telegramChannelEvents
              : [],
          });
        }
      } catch {
        setError("Не удалось загрузить настройки");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update<K extends keyof ChannelState>(key: K, value: ChannelState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleEvent(type: string, checked: boolean) {
    setState((s) => ({
      ...s,
      telegramChannelEvents: checked
        ? [...new Set([...s.telegramChannelEvents, type])]
        : s.telegramChannelEvents.filter((t) => t !== type),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/gazebos/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramChannelEnabled: state.telegramChannelEnabled,
          telegramChannelName: state.telegramChannelName,
          telegramChannelId: state.telegramChannelId.trim(),
          telegramChannelEvents: state.telegramChannelEvents,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message ?? "Ошибка сохранения");
      }
      setMessage("Настройки канала сохранены");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const chatId = state.telegramChannelId.trim();
      const res = await fetch("/api/gazebos/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatId ? { chatId } : {}),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message ?? "Не удалось отправить тест");
      }
      setMessage(
        json.data?.chatTitle
          ? `Тестовое сообщение отправлено в «${json.data.chatTitle}»`
          : "Тестовое сообщение отправлено"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить тест");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="py-6 text-sm text-zinc-400 animate-pulse">Загрузка…</div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Telegram-канал беседок</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Отдельный канал/группа для уведомлений только по беседкам. Используется
          тот же бот платформы — добавьте его в группу/канал с правом отправки
          сообщений и укажите её ID или @username ниже.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={state.telegramChannelEnabled}
            onChange={(e) => update("telegramChannelEnabled", e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div>
            <p className="font-semibold text-zinc-900">Канал включён</p>
            <p className="text-sm text-zinc-500 mt-1">
              Когда выключено — уведомления в этот канал не отправляются.
            </p>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 mb-1 block">
            Имя канала (для удобства)
          </span>
          <input
            type="text"
            value={state.telegramChannelName}
            onChange={(e) => update("telegramChannelName", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Беседки — уведомления"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 mb-1 block">
            ID или @username канала
          </span>
          <input
            type="text"
            value={state.telegramChannelId}
            onChange={(e) => update("telegramChannelId", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="-1001234567890 или @gazebos_channel"
          />
        </label>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 space-y-3">
        <p className="font-medium text-zinc-900">Какие уведомления слать в канал</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GAZEBO_CHANNEL_EVENTS.map((ev) => (
            <label key={ev.type} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={state.telegramChannelEvents.includes(ev.type)}
                onChange={(e) => toggleEvent(ev.type, e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-zinc-700">{ev.label}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          disabled={testing || saving}
          onClick={handleTest}
        >
          {testing ? "Отправка…" : "Отправить тест"}
        </Button>
        <Button type="submit" disabled={saving || testing}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
