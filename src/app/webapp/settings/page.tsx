"use client";

import { useEffect, useState } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";

interface Preferences {
  enableBooking: boolean;
  enableOrder: boolean;
  enableReminder: boolean;
  preferredChannel: "AUTO" | "TELEGRAM" | "WHATSAPP" | "EMAIL" | "VK";
}

interface ChannelInfo {
  channel: "TELEGRAM" | "WHATSAPP" | "EMAIL" | "VK";
  connected: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  AUTO: "Автоматически",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  VK: "ВКонтакте",
};

export default function SettingsPage() {
  const { apiFetch, showBackButton, onBackButtonClick, haptic } = useTelegram();

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  useEffect(() => {
    apiFetch<{ preferences: Preferences; availableChannels: ChannelInfo[] }>(
      "/api/webapp/preferences"
    )
      .then((data) => {
        setPrefs(data.preferences);
        setChannels(data.availableChannels);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [apiFetch]);

  async function updatePref(patch: Partial<Preferences>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    haptic.selection();
    setSaving(true);
    try {
      await apiFetch("/api/webapp/preferences", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      haptic.notification("success");
    } catch {
      // Revert on error
      setPrefs(prefs);
      haptic.notification("error");
    } finally {
      setSaving(false);
    }
  }

  const connectedChannels = channels.filter((c) => c.connected);
  const allDisabled = prefs && !prefs.enableBooking && !prefs.enableOrder && !prefs.enableReminder;

  if (loading || !prefs) {
    return (
      <div className="px-4 pt-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="tg-skeleton h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4">
        <h1 className="text-[20px] font-bold">Уведомления</h1>
        <p className="text-[14px] mt-1" style={{ color: "var(--tg-hint)" }}>
          Управляйте тем, что вам приходит
        </p>
      </div>

      {/* Category toggles */}
      <div className="px-4 mt-6">
        <p className="tg-section-header">Категории</p>
        <div className="rounded-2xl overflow-hidden mt-2" style={{ background: "var(--tg-secondary-bg)" }}>
          <Toggle
            label="Бронирования"
            description="Подтверждение и отмена броней"
            checked={prefs.enableBooking}
            saving={saving}
            onChange={(v) => updatePref({ enableBooking: v })}
          />
          <div className="border-t" style={{ borderColor: "rgba(0,0,0,0.08)" }} />
          <Toggle
            label="Заказы"
            description="Статус заказов из кафе"
            checked={prefs.enableOrder}
            saving={saving}
            onChange={(v) => updatePref({ enableOrder: v })}
          />
          <div className="border-t" style={{ borderColor: "rgba(0,0,0,0.08)" }} />
          <Toggle
            label="Напоминания"
            description="За час до начала бронирования"
            checked={prefs.enableReminder}
            saving={saving}
            onChange={(v) => updatePref({ enableReminder: v })}
          />
        </div>
      </div>

      {/* All-disabled warning */}
      {allDisabled && (
        <div className="px-4 mt-3">
          <div
            className="rounded-xl px-4 py-3 text-[13px]"
            style={{ background: "rgba(255, 150, 0, 0.1)", color: "#c97000" }}
          >
            Вы отключили все уведомления. Вы не будете получать подтверждения
            бронирований и статусы заказов.
          </div>
        </div>
      )}

      {/* Channel selector */}
      <div className="px-4 mt-6">
        <p className="tg-section-header">Способ доставки</p>
        <div className="rounded-2xl overflow-hidden mt-2" style={{ background: "var(--tg-secondary-bg)" }}>
          {/* AUTO option */}
          <ChannelOption
            label="Автоматически"
            description="Система выбирает лучший канал"
            selected={prefs.preferredChannel === "AUTO"}
            onChange={() => updatePref({ preferredChannel: "AUTO" })}
            saving={saving}
          />
          {connectedChannels.map((c, i) => (
            <div key={c.channel}>
              <div className="border-t" style={{ borderColor: "rgba(0,0,0,0.08)" }} />
              <ChannelOption
                label={CHANNEL_LABELS[c.channel]}
                description={`Через ${CHANNEL_LABELS[c.channel]}`}
                selected={prefs.preferredChannel === c.channel}
                onChange={() => updatePref({ preferredChannel: c.channel as Preferences["preferredChannel"] })}
                saving={saving}
              />
            </div>
          ))}
        </div>
        {connectedChannels.length === 0 && (
          <p className="text-[13px] mt-2" style={{ color: "var(--tg-hint)" }}>
            Привяжите email или телефон, чтобы получать уведомления через другие каналы.
          </p>
        )}
      </div>

      <div className="h-8" />
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  saving,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex-1 mr-4">
        <p className="text-[15px] font-medium">{label}</p>
        <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>
          {description}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={saving}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none ${
          saving ? "opacity-60" : ""
        }`}
        style={{
          background: checked ? "var(--tg-button)" : "rgba(120,120,128,0.32)",
        }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? "translateX(22px)" : "translateX(4px)" }}
        />
      </button>
    </div>
  );
}

function ChannelOption({
  label,
  description,
  selected,
  saving,
  onChange,
}: {
  label: string;
  description: string;
  selected: boolean;
  saving: boolean;
  onChange: () => void;
}) {
  return (
    <button
      className="flex items-center justify-between w-full px-4 py-3 text-left"
      disabled={saving}
      onClick={onChange}
    >
      <div className="flex-1">
        <p className="text-[15px] font-medium">{label}</p>
        <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>
          {description}
        </p>
      </div>
      <span
        className="h-5 w-5 rounded-full border-2 flex items-center justify-center"
        style={{
          borderColor: selected ? "var(--tg-button)" : "rgba(120,120,128,0.4)",
          background: selected ? "var(--tg-button)" : "transparent",
        }}
      >
        {selected && (
          <span className="h-2 w-2 rounded-full bg-white" />
        )}
      </span>
    </button>
  );
}
