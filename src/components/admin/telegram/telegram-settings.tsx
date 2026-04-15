"use client";

import { useState, useEffect, useCallback } from "react";

type Settings = {
  adminChatId: string;
  adminChatTitle?: string;
  ownerChatId: string;
  botUsername: string;
  botToken: string;
};

type TelegramUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  telegramId: string | null;
  role: "USER" | "MANAGER" | "SUPERADMIN";
  image: string | null;
  createdAt: string;
  _count: { bookings: number };
};

type AllUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  telegramId: string | null;
  role: "USER" | "MANAGER" | "SUPERADMIN";
};

// === Message Route Types ===
type RouteItem = {
  event: string;
  module: string;
  destination: string;
  destType: "group" | "owner" | "user";
  status: "ok" | "warn" | "off";
};

function buildRoutes(settings: Settings, managersLinked: number, managersTotal: number): RouteItem[] {
  const hasBot = !!settings.botToken;
  const hasGroup = !!settings.adminChatId;
  const hasOwner = !!settings.ownerChatId;

  return [
    // System alerts
    {
      event: "Health check / 5xx ошибки",
      module: "Мониторинг",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
    {
      event: "СРОЧНО! обращения от пользователей",
      module: "Обратная связь",
      destination: hasOwner ? `Владелец (${settings.ownerChatId})` : "Не настроено",
      destType: "owner",
      status: hasBot && hasOwner ? "ok" : hasBot ? "warn" : "off",
    },
    // Bookings
    {
      event: "Новое бронирование / отмена",
      module: "Барбекю Парк",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
    {
      event: "Новое бронирование / отмена",
      module: "Плей Парк",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
    // Cafe
    {
      event: "Новый заказ / готов к выдаче",
      module: "Кафе",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
    // Rental
    {
      event: "Новая заявка на аренду",
      module: "Аренда",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
    // User notifications
    {
      event: "Подтверждение / напоминание",
      module: "Пользователь",
      destination: managersLinked > 0 ? `Личные сообщения (${managersLinked} из ${managersTotal} менеджеров)` : "Не привязаны",
      destType: "user",
      status: hasBot && managersLinked > 0 ? "ok" : hasBot ? "warn" : "off",
    },
    // Inventory
    {
      event: "Низкий остаток / истекающий срок",
      module: "Склад",
      destination: hasGroup ? `Группа ${settings.adminChatTitle || settings.adminChatId}` : "Не настроено",
      destType: "group",
      status: hasBot && hasGroup ? "ok" : "off",
    },
  ];
}

// === Sub-components ===

function StatusDot({ status }: { status: "ok" | "warn" | "off" }) {
  const colors = {
    ok: "bg-green-500",
    warn: "bg-yellow-500",
    off: "bg-zinc-300",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />;
}

function StatusBadge({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 border border-green-200">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        {label}
      </span>
    );
  }
  if (warn) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 px-2.5 py-1 text-xs font-medium text-yellow-700 border border-yellow-200">
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-500 border border-zinc-200">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
      {label}
    </span>
  );
}

const DEST_ICONS: Record<string, string> = {
  group: "👥",
  owner: "👤",
  user: "💬",
};

// === Main Component ===

export function TelegramSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tgUsers, setTgUsers] = useState<TelegramUser[]>([]);
  const [managers, setManagers] = useState<AllUser[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [chatIdInput, setChatIdInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [editingTgId, setEditingTgId] = useState<string | null>(null);
  const [tgIdInput, setTgIdInput] = useState("");
  const [tgIdSaving, setTgIdSaving] = useState(false);
  const [testingOwner, setTestingOwner] = useState(false);
  const [testOwnerResult, setTestOwnerResult] = useState<{ ok: boolean; message: string } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/telegram");
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        setChatIdInput(data.data.adminChatId || "");
      }
    } catch { /* ignore */ }
  }, []);

  const loadTgUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/telegram/users");
      const data = await res.json();
      if (data.success) setTgUsers(data.data);
    } catch { /* ignore */ }
  }, []);

  const loadManagers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?search=");
      const data = await res.json();
      if (data.success) {
        setManagers(data.data.filter((u: AllUser) => u.role === "MANAGER" || u.role === "SUPERADMIN"));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSettings();
    loadTgUsers();
    loadManagers();
    fetch("/api/admin/permissions/me")
      .then((r) => r.json())
      .then((d) => { if (d.success && d.data.role === "SUPERADMIN") setIsSuperAdmin(true); })
      .catch(() => {});
  }, [loadSettings, loadTgUsers, loadManagers]);

  const handleSaveSettings = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/admin/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminChatId: chatIdInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        setSaveResult({ ok: true, message: "Сохранено" });
      } else {
        setSaveResult({ ok: false, message: data.error?.message || "Ошибка" });
      }
    } catch {
      setSaveResult({ ok: false, message: "Ошибка сети" });
    } finally {
      setSaving(false);
    }
  }, [chatIdInput]);

  const handleTestMessage = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/telegram/test", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const info = data.data.chatTitle ? ` (${data.data.chatTitle})` : "";
        setTestResult({ ok: true, message: `Сообщение отправлено${info}` });
        loadSettings();
      } else {
        setTestResult({ ok: false, message: data.error?.message || "Ошибка" });
      }
    } catch {
      setTestResult({ ok: false, message: "Ошибка сети" });
    } finally {
      setTesting(false);
    }
  }, [loadSettings]);

  const handleRoleChange = useCallback(async (userId: string, newRole: string) => {
    setRoleChanging(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        setTgUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole as TelegramUser["role"] } : u))
        );
        loadManagers();
      }
    } catch { /* ignore */ }
    finally { setRoleChanging(null); }
  }, [loadManagers]);

  const handleTestOwner = useCallback(async () => {
    setTestingOwner(true);
    setTestOwnerResult(null);
    try {
      const res = await fetch("/api/admin/telegram/test-owner", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const name = data.data.recipientUsername
          ? `@${data.data.recipientUsername}`
          : data.data.recipientName || data.data.chatId;
        setTestOwnerResult({ ok: true, message: `Отправлено: ${name}` });
      } else {
        setTestOwnerResult({ ok: false, message: data.error?.message || "Ошибка" });
      }
    } catch {
      setTestOwnerResult({ ok: false, message: "Ошибка сети" });
    } finally {
      setTestingOwner(false);
    }
  }, []);

  const handleSaveTelegramId = useCallback(async (userId: string) => {
    setTgIdSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: tgIdInput.trim() || null }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingTgId(null);
        setTgIdInput("");
        loadManagers();
        loadTgUsers();
      }
    } catch { /* ignore */ }
    finally { setTgIdSaving(false); }
  }, [tgIdInput, loadManagers, loadTgUsers]);

  if (!settings) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  const botHandle = settings.botUsername || "DelovoyPark_bot";
  const hasBot = !!settings.botToken;
  const hasGroup = !!settings.adminChatId;
  const hasOwner = !!settings.ownerChatId;
  const linkedManagers = managers.filter((m) => m.telegramId);
  const routes = buildRoutes(settings, linkedManagers.length, managers.length);

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ─── Bot Overview ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bot card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-lg">
              🤖
            </div>
            <div>
              <p className="font-semibold text-zinc-900">@{botHandle}</p>
              <p className="text-xs text-zinc-500">Telegram-бот</p>
            </div>
          </div>
          <StatusBadge ok={hasBot} label={hasBot ? "Подключён" : "Не настроен"} />
          {hasBot && (
            <p className="mt-2 text-xs text-zinc-400 font-mono">{settings.botToken}</p>
          )}
        </div>

        {/* Admin group card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-lg">
              👥
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Группа админов</p>
              <p className="text-xs text-zinc-500">Уведомления, алерты, заказы</p>
            </div>
          </div>
          <StatusBadge ok={hasGroup} label={hasGroup ? (settings.adminChatTitle || settings.adminChatId) : "Не настроена"} warn={!hasGroup && hasBot} />
        </div>

        {/* Owner card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-lg">
              👤
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Владелец</p>
              <p className="text-xs text-zinc-500">СРОЧНО обращения, критичные алерты</p>
            </div>
          </div>
          <StatusBadge
            ok={hasOwner}
            label={hasOwner ? `ID: ${settings.ownerChatId}` : "Не настроен"}
            warn={!hasOwner && hasBot}
          />
          {!hasOwner && (
            <p className="mt-2 text-xs text-orange-600">
              Задайте TELEGRAM_OWNER_CHAT_ID в .env
            </p>
          )}
        </div>
      </div>

      {/* ─── Message Routing Map ─── */}
      <section className="rounded-xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900">Маршрутизация сообщений</h2>
          <p className="text-sm text-zinc-500">Куда бот отправляет каждый тип уведомления</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50">
                <th className="text-left px-6 py-3 font-medium text-zinc-500 w-8"></th>
                <th className="text-left px-4 py-3 font-medium text-zinc-500">Событие</th>
                <th className="text-left px-4 py-3 font-medium text-zinc-500">Модуль</th>
                <th className="text-left px-4 py-3 font-medium text-zinc-500">Куда</th>
                <th className="text-left px-4 py-3 font-medium text-zinc-500">Получатель</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r, i) => (
                <tr key={i} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                  <td className="px-6 py-3">
                    <StatusDot status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-900 font-medium">{r.event}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {r.module}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    <span className="mr-1">{DEST_ICONS[r.destType]}</span>
                    {r.destType === "group" ? "Группа" : r.destType === "owner" ? "Личка владельца" : "Личка пользователя"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${r.status === "ok" ? "text-zinc-700" : r.status === "warn" ? "text-yellow-700" : "text-zinc-400"}`}>
                      {r.destination}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="border-t border-zinc-100 px-6 py-3 flex items-center gap-6 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5"><StatusDot status="ok" /> Работает</span>
          <span className="flex items-center gap-1.5"><StatusDot status="warn" /> Не настроен получатель</span>
          <span className="flex items-center gap-1.5"><StatusDot status="off" /> Выключено</span>
        </div>
      </section>

      {/* ─── Settings: Admin Group ─── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">Настройки группы админов</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Сюда бот отправляет: новые бронирования, заказы кафе, заявки на аренду, системные алерты.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="chatId" className="block text-sm font-medium text-zinc-700 mb-1">
              Chat ID группы
            </label>
            <div className="flex gap-2">
              <input
                id="chatId"
                type="text"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
                placeholder="-100xxxxxxxxxx"
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "..." : "Сохранить"}
              </button>
            </div>
            {saveResult && (
              <p className={`text-sm mt-1 ${saveResult.ok ? "text-green-600" : "text-red-500"}`}>
                {saveResult.message}
              </p>
            )}
            {settings.adminChatTitle && (
              <p className="text-sm text-zinc-500 mt-1">
                Группа: <span className="font-medium">{settings.adminChatTitle}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTestMessage}
              disabled={testing || !chatIdInput.trim()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              {testing ? "Отправка..." : "Отправить тестовое сообщение"}
            </button>
            {testResult && (
              <p className={`text-sm ${testResult.ok ? "text-green-600" : "text-red-500"}`}>
                {testResult.message}
              </p>
            )}
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-700">
              Как получить Chat ID?
            </summary>
            <div className="mt-2 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600 space-y-1">
              <ol className="list-decimal list-inside space-y-1">
                <li>Создайте группу в Telegram</li>
                <li>Добавьте @{botHandle} в группу</li>
                <li>Напишите любое сообщение в группу</li>
                <li>Chat ID появится в логах бота</li>
              </ol>
            </div>
          </details>
        </div>
      </section>

      {/* ─── Owner Chat ID Info ─── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">Личные сообщения владельцу</h2>
        <p className="text-sm text-zinc-500 mb-4">
          СРОЧНО-обращения от пользователей отправляются напрямую владельцу в Telegram.
        </p>
        <div className="rounded-lg bg-zinc-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-600">TELEGRAM_OWNER_CHAT_ID</span>
            {hasOwner ? (
              <span className="font-mono text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg">
                {settings.ownerChatId}
              </span>
            ) : (
              <span className="text-sm text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1 rounded-lg">
                Не задан
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Задаётся в <code className="bg-zinc-200 px-1 rounded">.env</code> на сервере.
            Получить свой ID: написать <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">@userinfobot</a> в Telegram.
          </p>
        </div>

        {isSuperAdmin && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleTestOwner}
              disabled={testingOwner || !hasOwner}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              {testingOwner ? "Отправка..." : "Отправить тестовое уведомление мне"}
            </button>
            {testOwnerResult && (
              <p className={`text-sm ${testOwnerResult.ok ? "text-green-600" : "text-red-500"}`}>
                {testOwnerResult.message}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ─── Managers & their Telegram ─── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Менеджеры и их Telegram</h2>
          <p className="text-sm text-zinc-500">
            Менеджеры с привязанным Telegram получают уведомления в личку от @{botHandle}.
          </p>
        </div>

        {managers.length === 0 ? (
          <div className="text-center py-6 text-zinc-400 text-sm">
            Нет менеджеров. Назначьте из таблицы пользователей ниже.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Имя</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Роль</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Контакты</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Telegram</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                    <td className="py-3 px-3 font-medium text-zinc-900">{user.name || "—"}</td>
                    <td className="py-3 px-3">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                        user.role === "SUPERADMIN"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-blue-50 text-blue-700"
                      }`}>
                        {user.role === "SUPERADMIN" ? "Суперадмин" : "Менеджер"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-zinc-500">{user.email || user.phone || "—"}</td>
                    <td className="py-3 px-3">
                      {editingTgId === user.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={tgIdInput}
                            onChange={(e) => setTgIdInput(e.target.value)}
                            placeholder="Telegram ID"
                            className="w-32 rounded border border-zinc-300 px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveTelegramId(user.id)}
                            disabled={tgIdSaving}
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            OK
                          </button>
                          <button
                            onClick={() => { setEditingTgId(null); setTgIdInput(""); }}
                            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700"
                          >
                            Отмена
                          </button>
                        </div>
                      ) : user.telegramId ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">
                            {user.telegramId}
                          </span>
                          <button
                            onClick={() => { setEditingTgId(user.id); setTgIdInput(user.telegramId || ""); }}
                            className="text-xs text-zinc-400 hover:text-zinc-600"
                          >
                            изм.
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                            Не привязан
                          </span>
                          <button
                            onClick={() => { setEditingTgId(user.id); setTgIdInput(""); }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Указать
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── All Telegram Users ─── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Все пользователи с Telegram</h2>
            <p className="text-sm text-zinc-500">
              Клиенты, которые писали боту или входили через Telegram.
            </p>
          </div>
          <span className="text-sm text-zinc-400">{tgUsers.length} чел.</span>
        </div>

        {tgUsers.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            Пока нет пользователей с привязанным Telegram
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Имя</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Telegram ID</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Контакты</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Брони</th>
                  <th className="text-left py-2 px-3 font-medium text-zinc-500">Роль</th>
                </tr>
              </thead>
              <tbody>
                {tgUsers.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        {user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">
                            {(user.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-zinc-900">{user.name || "—"}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-zinc-500 text-xs">{user.telegramId}</td>
                    <td className="py-3 px-3 text-zinc-500">{user.email || user.phone || "—"}</td>
                    <td className="py-3 px-3 text-zinc-500">{user._count.bookings}</td>
                    <td className="py-3 px-3">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={!isSuperAdmin || roleChanging === user.id}
                        className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          user.role === "SUPERADMIN"
                            ? "border-purple-200 bg-purple-50 text-purple-700"
                            : user.role === "MANAGER"
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600"
                        } ${roleChanging === user.id ? "opacity-50" : ""}`}
                      >
                        <option value="USER">Пользователь</option>
                        <option value="MANAGER">Менеджер</option>
                        <option value="SUPERADMIN">Суперадмин</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
