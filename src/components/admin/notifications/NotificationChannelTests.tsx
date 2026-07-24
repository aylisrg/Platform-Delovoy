"use client";

import { useState, useEffect, useCallback } from "react";

type RoutingRule = {
  key: string;
  label: string;
  description: string;
  icon: string;
  chatId: string | null;
  chatTitle: string | null;
  usesGlobal: boolean;
  enabled: boolean;
};

type GlobalConfig = { chatId: string; chatTitle: string | null };

type EventToggle = { type: string; label: string; enabled: boolean };

type ModuleChannel = {
  slug: string;
  label: string;
  icon: string;
  enabled: boolean;
  configured: boolean;
  chatId: string | null;
  channelName: string | null;
  usesOwnBot: boolean;
  events: EventToggle[];
};

type BadgeTone = "blue" | "zinc" | "amber";
type Badge = { text: string; tone: BadgeTone };

type ChannelRow = {
  id: string;
  kind: "routing" | "module-channel";
  refKey: string;
  icon: string;
  label: string;
  sublabel: string;
  destination: string | null;
  badges: Badge[];
  canTest: boolean;
  enabled: boolean;
  events: EventToggle[] | null;
};

type TestResult = { ok: boolean; message: string };

const BADGE_CLASSES: Record<BadgeTone, string> = {
  blue: "bg-blue-50 border-blue-200 text-blue-700",
  zinc: "bg-zinc-50 border-zinc-200 text-zinc-500",
  amber: "bg-amber-50 border-amber-200 text-amber-700",
};

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
        active ? "bg-green-500" : "bg-zinc-300"
      }`}
    />
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-green-500" : "bg-zinc-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function ChannelRowCard({
  row,
  testing,
  result,
  onTest,
  saving,
  enabledError,
  onToggleEnabled,
  savingEventType,
  onToggleEvent,
}: {
  row: ChannelRow;
  testing: boolean;
  result: TestResult | null;
  onTest: (row: ChannelRow) => void;
  saving: boolean;
  enabledError?: string;
  onToggleEnabled: (row: ChannelRow, next: boolean) => void;
  savingEventType: string | null;
  onToggleEvent: (row: ChannelRow, type: string, next: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-4 p-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xl">
          {row.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900">{row.label}</h3>
            <StatusDot active={row.enabled && row.canTest} />
          </div>
          <p className="text-sm text-zinc-500">{row.sublabel}</p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.destination ? (
              <>
                <span className="text-xs text-zinc-400">Куда:</span>
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  {row.destination}
                </span>
              </>
            ) : (
              <span className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs text-orange-600">
                Канал не настроен
              </span>
            )}
            {row.badges.map((b) => (
              <span
                key={b.text}
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${BADGE_CLASSES[b.tone]}`}
              >
                {b.text}
              </span>
            ))}
          </div>

          {row.events && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-zinc-100 pt-2.5">
              {row.events.map((ev) => (
                <label
                  key={ev.type}
                  className="flex items-center gap-1.5 text-xs text-zinc-600"
                >
                  <input
                    type="checkbox"
                    checked={ev.enabled}
                    disabled={savingEventType === ev.type}
                    onChange={(e) => onToggleEvent(row, ev.type, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-zinc-300"
                  />
                  {ev.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">
              {row.enabled ? "Включено" : "Выключено"}
            </span>
            <ToggleSwitch
              checked={row.enabled}
              disabled={saving}
              onChange={(next) => onToggleEnabled(row, next)}
              label={`Включить/выключить уведомления: ${row.label}`}
            />
          </div>
          <button
            onClick={() => onTest(row)}
            disabled={testing || !row.canTest}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
            title="Отправить тестовое сообщение в этот канал"
          >
            {testing ? "..." : "Тест"}
          </button>
        </div>
      </div>

      {enabledError && (
        <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {enabledError}
        </div>
      )}

      {result && (
        <div
          className={`mx-4 mb-3 rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}

function routingToRow(rule: RoutingRule, global: GlobalConfig): ChannelRow {
  const effectiveChatId = rule.chatId || global.chatId;
  const effectiveTitle =
    rule.chatTitle || (rule.usesGlobal ? global.chatTitle : null);
  const badges: Badge[] = [];
  if (effectiveChatId) {
    badges.push(
      rule.chatId
        ? { text: "Свой чат", tone: "blue" }
        : { text: "Глобальный чат", tone: "zinc" }
    );
  }
  if (!rule.enabled) {
    badges.push({ text: "Ничего не отправляется", tone: "amber" });
  }
  return {
    id: `routing:${rule.key}`,
    kind: "routing",
    refKey: rule.key,
    icon: rule.icon,
    label: rule.label,
    sublabel: rule.description,
    destination: effectiveChatId ? effectiveTitle || effectiveChatId : null,
    badges,
    canTest: Boolean(effectiveChatId),
    enabled: rule.enabled,
    events: null,
  };
}

function moduleToRow(channel: ModuleChannel): ChannelRow {
  const badges: Badge[] = [{ text: "Канал модуля", tone: "blue" }];
  if (channel.usesOwnBot) badges.push({ text: "свой бот", tone: "zinc" });
  if (channel.configured && !channel.enabled) {
    badges.push({ text: "Ничего не отправляется", tone: "amber" });
  }
  return {
    id: `module:${channel.slug}`,
    kind: "module-channel",
    refKey: channel.slug,
    icon: channel.icon,
    label: `${channel.label} — выделенный канал`,
    sublabel: "Отдельный публичный канал модуля",
    destination: channel.configured
      ? channel.channelName || channel.chatId
      : null,
    badges,
    canTest: channel.configured,
    enabled: channel.enabled,
    events: channel.events,
  };
}

export function NotificationChannelTests() {
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({
    chatId: "",
    chatTitle: null,
  });
  const [moduleChannels, setModuleChannels] = useState<ModuleChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [routingRes, modulesRes] = await Promise.allSettled([
        fetch("/api/admin/notifications/routing").then((r) => r.json()),
        fetch("/api/admin/notifications/channel-test").then((r) => r.json()),
      ]);
      if (routingRes.status === "fulfilled" && routingRes.value?.success) {
        setRoutingRules(routingRes.value.data.rules ?? []);
        setGlobalConfig(
          routingRes.value.data.global ?? { chatId: "", chatTitle: null }
        );
      }
      if (modulesRes.status === "fulfilled" && modulesRes.value?.success) {
        setModuleChannels(modulesRes.value.data.moduleChannels ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = useCallback(async (row: ChannelRow) => {
    setTestingId(row.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    try {
      const payload =
        row.kind === "routing"
          ? { kind: "routing", key: row.refKey }
          : { kind: "module-channel", slug: row.refKey };
      const res = await fetch("/api/admin/notifications/channel-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const result: TestResult = data.success
        ? {
            ok: true,
            message: `Отправлено в ${data.data.chatTitle || data.data.chatId}`,
          }
        : { ok: false, message: data.error?.message || "Ошибка отправки" };
      setResults((prev) => ({ ...prev, [row.id]: result }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [row.id]: { ok: false, message: "Ошибка сети" },
      }));
    } finally {
      setTestingId(null);
    }
  }, []);

  const handleToggleEnabled = useCallback(
    async (row: ChannelRow, next: boolean) => {
      setSavingId(row.id);
      setSaveErrors((prev) => {
        const copy = { ...prev };
        delete copy[row.id];
        return copy;
      });

      // Optimistic update.
      if (row.kind === "routing") {
        setRoutingRules((prev) =>
          prev.map((r) => (r.key === row.refKey ? { ...r, enabled: next } : r))
        );
      } else {
        setModuleChannels((prev) =>
          prev.map((c) => (c.slug === row.refKey ? { ...c, enabled: next } : c))
        );
      }

      try {
        const res =
          row.kind === "routing"
            ? await fetch("/api/admin/notifications/routing", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: row.refKey, enabled: next }),
              })
            : await fetch("/api/admin/notifications/channel-test", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  slug: row.refKey,
                  telegramChannelEnabled: next,
                }),
              });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error?.message || "Ошибка сохранения");
        }
      } catch (err) {
        // Revert on failure.
        if (row.kind === "routing") {
          setRoutingRules((prev) =>
            prev.map((r) =>
              r.key === row.refKey ? { ...r, enabled: !next } : r
            )
          );
        } else {
          setModuleChannels((prev) =>
            prev.map((c) =>
              c.slug === row.refKey ? { ...c, enabled: !next } : c
            )
          );
        }
        setSaveErrors((prev) => ({
          ...prev,
          [row.id]: err instanceof Error ? err.message : "Ошибка сети",
        }));
      } finally {
        setSavingId(null);
      }
    },
    []
  );

  const handleToggleEvent = useCallback(
    async (row: ChannelRow, type: string, next: boolean) => {
      const eventKey = `${row.id}:${type}`;
      const channel = moduleChannels.find((c) => c.slug === row.refKey);
      if (!channel) return;

      const updatedEvents = channel.events.map((e) =>
        e.type === type ? { ...e, enabled: next } : e
      );
      const enabledTypes = updatedEvents
        .filter((e) => e.enabled)
        .map((e) => e.type);

      setSavingId(eventKey);
      setSaveErrors((prev) => {
        const copy = { ...prev };
        delete copy[eventKey];
        return copy;
      });
      setModuleChannels((prev) =>
        prev.map((c) =>
          c.slug === row.refKey ? { ...c, events: updatedEvents } : c
        )
      );

      try {
        const res = await fetch("/api/admin/notifications/channel-test", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: row.refKey,
            telegramChannelEvents: enabledTypes,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error?.message || "Ошибка сохранения");
        }
      } catch (err) {
        setModuleChannels((prev) =>
          prev.map((c) =>
            c.slug === row.refKey
              ? {
                  ...c,
                  events: c.events.map((e) =>
                    e.type === type ? { ...e, enabled: !next } : e
                  ),
                }
              : c
          )
        );
        setSaveErrors((prev) => ({
          ...prev,
          [eventKey]: err instanceof Error ? err.message : "Ошибка сети",
        }));
      } finally {
        setSavingId(null);
      }
    },
    [moduleChannels]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  const routingRows = routingRules.map((r) => routingToRow(r, globalConfig));
  const moduleRows = moduleChannels.map(moduleToRow);

  const getRowError = (row: ChannelRow): string | undefined => {
    if (saveErrors[row.id]) return saveErrors[row.id];
    const eventErrorKey = Object.keys(saveErrors).find((k) =>
      k.startsWith(`${row.id}:`)
    );
    return eventErrorKey ? saveErrors[eventErrorKey] : undefined;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-500">Категории уведомлений</h3>
        {routingRows.map((row) => (
          <ChannelRowCard
            key={row.id}
            row={row}
            testing={testingId === row.id}
            result={results[row.id] ?? null}
            onTest={handleTest}
            saving={savingId === row.id}
            enabledError={getRowError(row)}
            onToggleEnabled={handleToggleEnabled}
            savingEventType={null}
            onToggleEvent={handleToggleEvent}
          />
        ))}
      </div>

      {moduleRows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-500">
            Выделенные каналы модулей
          </h3>
          {moduleRows.map((row) => (
            <ChannelRowCard
              key={row.id}
              row={row}
              testing={testingId === row.id}
              result={results[row.id] ?? null}
              onTest={handleTest}
              saving={savingId === row.id}
              enabledError={getRowError(row)}
              onToggleEnabled={handleToggleEnabled}
              savingEventType={
                savingId?.startsWith(`${row.id}:`)
                  ? savingId.slice(`${row.id}:`.length)
                  : null
              }
              onToggleEvent={handleToggleEvent}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-400">
        Переключатель справа включает/выключает отправку в конкретный канал —
        изменения применяются сразу. Для выделенных каналов модулей ниже можно
        также выбрать, какие именно события туда попадают. Кнопка «Тест»
        отправляет проверочное сообщение независимо от переключателя: «Это
        тестовое сообщение в канал «(название)» от Бота Деловой. Всё работает
        штатно.» Кнопки для группы админов и владельца — в блоке «Настройки
        Telegram-бота» ниже.
      </p>
    </div>
  );
}
