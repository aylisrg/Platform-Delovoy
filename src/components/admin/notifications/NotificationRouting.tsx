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

type GlobalConfig = {
  chatId: string;
  chatTitle: string | null;
};

type TestResult = {
  ok: boolean;
  message: string;
};

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${
        active ? "bg-green-500" : "bg-zinc-300"
      }`}
    />
  );
}

function RoutingCard({
  rule,
  globalConfig,
  onSave,
  onTest,
}: {
  rule: RoutingRule;
  globalConfig: GlobalConfig;
  onSave: (key: string, chatId: string | null) => Promise<void>;
  onTest: (key: string, chatId?: string) => Promise<TestResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [chatIdInput, setChatIdInput] = useState(rule.chatId || "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveResult, setSaveResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const effectiveChatId = rule.chatId || globalConfig.chatId;
  const effectiveTitle =
    rule.chatTitle ||
    (rule.usesGlobal ? globalConfig.chatTitle : null);
  const hasOwnChat = !!rule.chatId;

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const value = chatIdInput.trim() || null;
      await onSave(rule.key, value);
      setSaveResult({ ok: true, message: "Сохранено" });
      setEditing(false);
    } catch {
      setSaveResult({ ok: false, message: "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      await onSave(rule.key, null);
      setChatIdInput("");
      setSaveResult({
        ok: true,
        message: "Сброшено на глобальный чат",
      });
      setEditing(false);
    } catch {
      setSaveResult({ ok: false, message: "Ошибка" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await onTest(
      rule.key,
      editing ? chatIdInput.trim() || undefined : undefined
    );
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-4 p-5">
        {/* Icon */}
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100 text-xl flex-shrink-0">
          {rule.icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold text-zinc-900">{rule.label}</h3>
            <StatusDot active={!!effectiveChatId} />
          </div>
          <p className="text-sm text-zinc-500">{rule.description}</p>

          {/* Current destination */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {effectiveChatId ? (
              <>
                <span className="text-xs text-zinc-400">Куда:</span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  {effectiveTitle || effectiveChatId}
                </span>
                {hasOwnChat ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    Свой чат
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                    Глобальный
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg">
                Чат не настроен
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleTest}
            disabled={testing || !effectiveChatId}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
            title="Отправить тестовое сообщение"
          >
            {testing ? "..." : "Тест"}
          </button>
          <button
            onClick={() => {
              setEditing(!editing);
              setChatIdInput(rule.chatId || "");
              setSaveResult(null);
              setTestResult(null);
            }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              editing
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {editing ? "Отмена" : "Настроить"}
          </button>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`mx-5 mb-3 rounded-lg px-3 py-2 text-xs ${
            testResult.ok
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {testResult.message}
        </div>
      )}

      {/* Edit panel */}
      {editing && (
        <div className="border-t border-zinc-100 px-5 py-4 bg-zinc-50/50">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">
                Chat ID для «{rule.label}»
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatIdInput}
                  onChange={(e) => setChatIdInput(e.target.value)}
                  placeholder={
                    globalConfig.chatId
                      ? `Оставьте пустым для глобального (${globalConfig.chatId})`
                      : "-100xxxxxxxxxx"
                  }
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "..." : "Сохранить"}
                </button>
              </div>
              {saveResult && (
                <p
                  className={`text-xs mt-1.5 ${
                    saveResult.ok ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {saveResult.message}
                </p>
              )}
            </div>

            {hasOwnChat && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="text-xs text-zinc-500 hover:text-red-600 transition-colors underline underline-offset-2"
              >
                Сбросить на глобальный чат
              </button>
            )}

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Укажите Chat ID Telegram-группы, куда отправлять уведомления этой
              категории. Если оставить пустым — будет использоваться глобальный
              чат.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationRouting() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({
    chatId: "",
    chatTitle: null,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications/routing");
      const data = await res.json();
      if (data.success) {
        setRules(data.data.rules);
        setGlobalConfig(data.data.global);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(
    async (key: string, chatId: string | null) => {
      const res = await fetch("/api/admin/notifications/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, chatId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message);

      // Reload to get fresh state
      await load();
    },
    [load]
  );

  const handleTest = useCallback(
    async (key: string, chatId?: string): Promise<TestResult> => {
      try {
        const res = await fetch("/api/admin/notifications/routing/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, chatId }),
        });
        const data = await res.json();
        if (data.success) {
          const title = data.data.chatTitle;
          // Reload to pick up auto-saved chat title
          load();
          return {
            ok: true,
            message: title
              ? `Отправлено в ${title}`
              : `Отправлено в ${data.data.chatId}`,
          };
        }
        return {
          ok: false,
          message: data.error?.message || "Ошибка отправки",
        };
      } catch {
        return { ok: false, message: "Ошибка сети" };
      }
    },
    [load]
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  const configuredCount = rules.filter((r) => r.chatId).length;
  const totalWithChat = rules.filter(
    (r) => r.chatId || globalConfig.chatId
  ).length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Summary */}
      <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-lg flex-shrink-0">
          🔀
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-zinc-900">Маршрутизация уведомлений</h2>
          <p className="text-sm text-zinc-500">
            Настройте, в какой Telegram-чат отправлять каждый тип уведомлений
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            <span className="font-semibold text-blue-700">{configuredCount}</span>
            <span className="text-zinc-500"> свой чат</span>
          </span>
          <span>
            <span className="font-semibold text-green-700">{totalWithChat}</span>
            <span className="text-zinc-500"> / {rules.length} активных</span>
          </span>
        </div>
      </div>

      {/* Global fallback info */}
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 text-lg">🌐</span>
          <div>
            <p className="text-sm font-medium text-zinc-700">
              Глобальный чат (по умолчанию)
            </p>
            {globalConfig.chatId ? (
              <p className="text-xs text-zinc-500">
                {globalConfig.chatTitle || globalConfig.chatId} — используется
                для категорий без собственного чата
              </p>
            ) : (
              <p className="text-xs text-orange-600">
                Не настроен. Задайте в{" "}
                <a
                  href="/admin/monitoring"
                  className="underline hover:text-orange-700"
                >
                  Мониторинг → Telegram
                </a>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Routing cards */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <RoutingCard
            key={rule.key}
            rule={rule}
            globalConfig={globalConfig}
            onSave={handleSave}
            onTest={handleTest}
          />
        ))}
      </div>

      {/* Help section */}
      <details className="group">
        <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-700">
          Как это работает?
        </summary>
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 space-y-3">
          <p>
            Каждая категория уведомлений может иметь свой собственный
            Telegram-чат. Если для категории не задан отдельный чат — используется
            глобальный.
          </p>
          <p className="font-medium text-zinc-700">Примеры использования:</p>
          <ul className="list-disc list-inside space-y-1 text-zinc-500">
            <li>
              Заказы кафе → в чат кухни, бронирования → в чат менеджеров
            </li>
            <li>
              Обратная связь → лично владельцу, системные алерты → в чат
              разработки
            </li>
            <li>
              Все уведомления в один чат — просто не настраивайте отдельные
            </li>
          </ul>
          <p className="font-medium text-zinc-700">Как получить Chat ID:</p>
          <ol className="list-decimal list-inside space-y-1 text-zinc-500">
            <li>Создайте группу в Telegram</li>
            <li>Добавьте бота @DelovoyPark_bot в группу</li>
            <li>Напишите любое сообщение в группу</li>
            <li>
              Нажмите «Тест» напротив нужной категории — Chat ID определится
              автоматически
            </li>
          </ol>
        </div>
      </details>
    </div>
  );
}
