"use client";

import { useState, useEffect, useCallback } from "react";

type Settings = {
  adminChatId: string;
  adminChatTitle?: string;
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

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/telegram");
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        setChatIdInput(data.data.adminChatId || "");
      }
    } catch {
      // ignore
    }
  }, []);

  const loadTgUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/telegram/users");
      const data = await res.json();
      if (data.success) {
        setTgUsers(data.data);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadManagers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?search=");
      const data = await res.json();
      if (data.success) {
        const mgrs = data.data.filter(
          (u: AllUser) => u.role === "MANAGER" || u.role === "SUPERADMIN"
        );
        setManagers(mgrs);
      }
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    } finally {
      setRoleChanging(null);
    }
  }, [loadManagers]);

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
    } catch {
      // ignore
    } finally {
      setTgIdSaving(false);
    }
  }, [tgIdInput, loadManagers, loadTgUsers]);

  if (!settings) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  const botHandle = settings.botUsername || "DelovoyPark_bot";

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Bot Status */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900 mb-4">
          Бот @{botHandle}
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-sm text-zinc-500">Username</span>
            <p className="font-medium text-zinc-900">@{botHandle}</p>
          </div>
          <div>
            <span className="text-sm text-zinc-500">Токен</span>
            <p className="font-mono text-sm text-zinc-600">
              {settings.botToken || "Не указан"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${settings.botToken ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm text-zinc-600">
            {settings.botToken ? "Подключён" : "Не подключён"}
          </span>
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          Бот отвечает всем пользователям — бронирование, меню кафе, мои заявки.
          Админ-уведомления отправляются в группу ниже.
        </p>
      </section>

      {/* Admin Group Chat */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">
          Админ-группа для уведомлений
        </h2>
        <p className="text-sm text-zinc-500 mb-4">
          @{botHandle} будет отправлять сюда уведомления: новые бронирования, заказы кафе, системные алерты.
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

          <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600 space-y-1">
            <p className="font-medium text-zinc-700">Как получить Chat ID:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Создайте группу в Telegram</li>
              <li>Добавьте @{botHandle} в группу</li>
              <li>Напишите любое сообщение в группу</li>
              <li>Chat ID появится в логах бота, или откройте getUpdates</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Managers & their Telegram */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">Менеджеры и их Telegram</h2>
          <p className="text-sm text-zinc-500">
            Чтобы менеджер получал уведомления в личку от @{botHandle}, у него должен быть указан Telegram.
            Менеджер может привязать ТГ сам (войти через Telegram на сайте) или вы укажите его ID вручную.
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
                    <td className="py-3 px-3 font-medium text-zinc-900">
                      {user.name || "—"}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                        user.role === "SUPERADMIN"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-blue-50 text-blue-700"
                      }`}>
                        {user.role === "SUPERADMIN" ? "Суперадмин" : "Менеджер"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-zinc-500">
                      {user.email || user.phone || "—"}
                    </td>
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

        <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
          <p className="font-medium">Как менеджеру привязать Telegram:</p>
          <p className="mt-1">Менеджер может войти на сайт через кнопку &quot;Войти через Telegram&quot; — его аккаунт автоматически привяжется. Или вы можете ввести его Telegram ID вручную (попросите менеджера написать /start боту @{botHandle} и прислать свой ID).</p>
        </div>
      </section>

      {/* All Telegram Users */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Все пользователи с Telegram</h2>
            <p className="text-sm text-zinc-500">
              Клиенты, которые писали боту или входили через Telegram. Можно назначить менеджером.
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
                          <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">
                            {(user.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-zinc-900">{user.name || "—"}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-zinc-500 text-xs">
                      {user.telegramId}
                    </td>
                    <td className="py-3 px-3 text-zinc-500">
                      {user.email || user.phone || "—"}
                    </td>
                    <td className="py-3 px-3 text-zinc-500">
                      {user._count.bookings}
                    </td>
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
