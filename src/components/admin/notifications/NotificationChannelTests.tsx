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
};

type GlobalConfig = { chatId: string; chatTitle: string | null };

type ModuleChannel = {
  slug: string;
  label: string;
  icon: string;
  enabled: boolean;
  configured: boolean;
  chatId: string | null;
  channelName: string | null;
  usesOwnBot: boolean;
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

function ChannelRowCard({
  row,
  testing,
  result,
  onTest,
}: {
  row: ChannelRow;
  testing: boolean;
  result: TestResult | null;
  onTest: (row: ChannelRow) => void;
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
            <StatusDot active={row.canTest} />
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
        </div>

        <button
          onClick={() => onTest(row)}
          disabled={testing || !row.canTest}
          className="flex-shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40"
          title="Отправить тестовое сообщение в этот канал"
        >
          {testing ? "..." : "Тест"}
        </button>
      </div>

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
  };
}

function moduleToRow(channel: ModuleChannel): ChannelRow {
  const badges: Badge[] = [{ text: "Канал модуля", tone: "blue" }];
  if (channel.usesOwnBot) badges.push({ text: "свой бот", tone: "zinc" });
  if (channel.configured && !channel.enabled) {
    badges.push({ text: "уведомления выключены", tone: "amber" });
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
            />
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-400">
        Кнопка «Тест» отправляет проверочное сообщение в конкретный канал:
        «Это тестовое сообщение в канал «(название)» от Бота Деловой. Всё
        работает штатно.» Кнопки для группы админов и владельца — в блоке
        «Настройки Telegram-бота» ниже.
      </p>
    </div>
  );
}
