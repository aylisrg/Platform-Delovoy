"use client";

import { useCallback, useEffect, useState } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  ListItem,
  SectionHeader,
  Skeleton,
  Toggle,
} from "@/components/webapp/ui";

interface Preferences {
  enableBooking: boolean;
  enableOrder: boolean;
  enableReminder: boolean;
  preferredChannel: "AUTO" | "TELEGRAM" | "EMAIL" | "VK";
}

interface ChannelInfo {
  channel: "TELEGRAM" | "EMAIL" | "VK";
  connected: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  AUTO: "Автоматически",
  TELEGRAM: "Telegram",
  EMAIL: "Email",
  VK: "ВКонтакте",
};

export default function SettingsPage() {
  const { ready, apiFetch, showBackButton, onBackButtonClick, haptic } =
    useTelegram();

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  // Загрузка предпочтений — тот же GET /api/webapp/preferences, что и раньше.
  const load = useCallback(() => {
    apiFetch<{ preferences: Preferences; availableChannels: ChannelInfo[] }>(
      "/api/webapp/preferences"
    )
      .then((data) => {
        setPrefs(data.preferences);
        setChannels(data.availableChannels);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  // Ждём завершения bootstrap: до него токена нет и запрос гарантированно
  // вернул бы 401 (лишний round-trip на мобильной сети).
  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const retry = () => {
    setLoading(true);
    setFailed(false);
    load();
  };

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
  const allDisabled =
    prefs && !prefs.enableBooking && !prefs.enableOrder && !prefs.enableReminder;

  if (loading) {
    return (
      <div className="px-4 pt-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (failed || !prefs) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <EmptyState
          icon="alert"
          title="Не удалось загрузить настройки"
          hint="Проверьте соединение и попробуйте ещё раз"
          action={<Button onClick={retry}>Обновить</Button>}
        />
      </div>
    );
  }

  return (
    <div className="tg-page-enter pb-8">
      <div className="px-4 pt-4">
        <h1 className="text-[24px] font-bold">Уведомления и каналы</h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--tg-hint)" }}>
          Управляйте тем, что вам приходит и куда
        </p>
      </div>

      {/* Category toggles */}
      <div className="px-4 mt-5">
        <SectionHeader>Категории</SectionHeader>
        <Card className="mt-1">
          <PreferenceRow
            icon="calendar"
            label="Бронирования"
            description="Подтверждение и отмена броней"
            checked={prefs.enableBooking}
            saving={saving}
            onChange={(v) => updatePref({ enableBooking: v })}
          />
          <PreferenceRow
            icon="coffee"
            label="Заказы"
            description="Статус заказов из кафе"
            checked={prefs.enableOrder}
            saving={saving}
            onChange={(v) => updatePref({ enableOrder: v })}
          />
          <PreferenceRow
            icon="clock"
            label="Напоминания"
            description="За час до начала бронирования"
            checked={prefs.enableReminder}
            saving={saving}
            onChange={(v) => updatePref({ enableReminder: v })}
          />
        </Card>
      </div>

      {/* All-disabled warning */}
      {allDisabled && (
        <div className="px-4 mt-3">
          <Card className="p-4">
            <div className="flex items-start gap-2.5">
              <span
                className="shrink-0 mt-0.5"
                style={{ color: "var(--tg-destructive)" }}
              >
                <Icon name="alert" size={18} />
              </span>
              <p className="text-[13px] leading-relaxed">
                Вы отключили все уведомления. Подтверждения бронирований и
                статусы заказов приходить не будут.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Channel selector */}
      <div className="px-4 mt-6">
        <SectionHeader>Способ доставки</SectionHeader>
        <Card className="mt-1">
          <ListItem
            title="Автоматически"
            subtitle="Система выбирает лучший канал"
            disabled={saving}
            onClick={() => updatePref({ preferredChannel: "AUTO" })}
            right={<SelectedMark selected={prefs.preferredChannel === "AUTO"} />}
          />
          {connectedChannels.map((c) => (
            <ListItem
              key={c.channel}
              title={CHANNEL_LABELS[c.channel]}
              subtitle={`Через ${CHANNEL_LABELS[c.channel]}`}
              disabled={saving}
              onClick={() =>
                updatePref({
                  preferredChannel: c.channel as Preferences["preferredChannel"],
                })
              }
              right={
                <SelectedMark selected={prefs.preferredChannel === c.channel} />
              }
            />
          ))}
        </Card>
        {connectedChannels.length === 0 && (
          <p
            className="text-[13px] mt-2 px-1 leading-relaxed"
            style={{ color: "var(--tg-hint)" }}
          >
            Привяжите email или телефон, чтобы получать уведомления через другие
            каналы.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Строка с переключателем. Собрана из тех же классов, что ListItem, но своим
 * контейнером-div: ListItem рендерит button/Link, а Toggle — тоже button,
 * вложенная кнопка ломала бы разметку и гидрацию.
 */
function PreferenceRow({
  icon,
  label,
  description,
  checked,
  saving,
  onChange,
}: {
  icon: WebAppIconName;
  label: string;
  description: string;
  checked: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="tg-list-item">
      <span
        className="flex items-center justify-center w-7 h-7 shrink-0"
        style={{ color: "var(--tg-accent)" }}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] leading-tight">{label}</span>
        <span
          className="block text-[13px] mt-0.5"
          style={{ color: "var(--tg-subtitle)" }}
        >
          {description}
        </span>
      </span>
      <Toggle
        checked={checked}
        disabled={saving}
        onChange={onChange}
        label={label}
      />
    </div>
  );
}

/** Отметка выбранного канала — иконка из набора, без эмодзи (AC-7.3). */
function SelectedMark({ selected }: { selected: boolean }) {
  if (!selected) return null;
  return (
    <span style={{ color: "var(--tg-accent)" }}>
      <Icon name="check" size={20} />
    </span>
  );
}
