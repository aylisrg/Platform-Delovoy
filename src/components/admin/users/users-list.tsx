"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateUserForm } from "./create-user-form";
import { PermissionsModal } from "./permissions-modal";

type Role = "SUPERADMIN" | "ADMIN" | "MANAGER" | "USER";

interface User {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  createdAt: string;
  notificationPreference: { notifyReleases: boolean } | null;
  authProviders?: string[];
}

const PROVIDER_BADGE: Record<string, { icon: string; color: string; label: string }> = {
  telegram: { icon: "TG", color: "bg-sky-100 text-sky-700", label: "Telegram" },
  yandex: { icon: "Ya", color: "bg-yellow-100 text-yellow-700", label: "Yandex" },
  credentials: { icon: "@", color: "bg-zinc-100 text-zinc-600", label: "Email" },
  google: { icon: "G", color: "bg-red-50 text-red-600", label: "Google" },
  whatsapp: { icon: "WA", color: "bg-green-100 text-green-700", label: "WhatsApp" },
};

const roleVariant: Record<Role, "danger" | "warning" | "default"> = {
  SUPERADMIN: "danger",
  ADMIN: "danger",
  MANAGER: "warning",
  USER: "default",
};

const roleLabel: Record<Role, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

function AuthProviderBadges({ providers }: { providers?: string[] }) {
  if (!providers || providers.length === 0) return <span className="text-zinc-300">—</span>;
  return (
    <div className="flex gap-1 flex-wrap">
      {providers.map((p) => {
        const info = PROVIDER_BADGE[p];
        return (
          <span
            key={p}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${info?.color || "bg-zinc-100 text-zinc-600"}`}
            title={info?.label || p}
          >
            {info?.icon || p}
          </span>
        );
      })}
    </div>
  );
}

export function UsersList({ filterRole }: { filterRole?: "team" | undefined }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<User | null>(null);
  const [togglingRelease, setTogglingRelease] = useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const fetchUsers = useCallback(async (searchQuery?: string, pageNum = 0) => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (filterRole === "team") params.set("role", "team");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageNum * PAGE_SIZE));
      const qs = params.toString();
      const res = await fetch(`/api/users${qs ? `?${qs}` : ""}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
        if (data.meta?.total !== undefined) setTotal(data.meta.total);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [filterRole]);

  useEffect(() => {
    fetchUsers(undefined, 0);
  }, [fetchUsers]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      fetchUsers(search || undefined, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchUsers]);

  async function handleRoleChange(userId: string, newRole: Role) {
    setSavingRole(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
        setEditingRole(null);
      } else {
        alert(data.error?.message || "Ошибка изменения роли");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setSavingRole(null);
    }
  }

  async function handleReleaseNotifyToggle(user: User) {
    const current = user.notificationPreference?.notifyReleases ?? false;
    setTogglingRelease(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/notify-releases`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !current }),
      });
      const data = await res.json();
      if (data.success) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id
              ? {
                  ...u,
                  notificationPreference: {
                    ...u.notificationPreference,
                    notifyReleases: data.data.notifyReleases,
                  },
                }
              : u
          )
        );
      } else {
        alert(data.error?.message || "Ошибка обновления настроек");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setTogglingRelease(null);
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("Удалить пользователя? Это действие необратимо.")) return;
    setDeleting(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      } else {
        alert(data.error?.message || "Ошибка удаления");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setDeleting(null);
    }
  }

  const stats = {
    total: users.length,
    superadmins: users.filter((u) => u.role === "SUPERADMIN").length,
    managers: users.filter((u) => u.role === "MANAGER").length,
    regular: users.filter((u) => u.role === "USER").length,
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Всего" value={stats.total} />
        <StatCard label="Суперадмины" value={stats.superadmins} color="text-red-600" />
        <StatCard label="Менеджеры" value={stats.managers} color="text-amber-600" />
        <StatCard label="Пользователи" value={stats.regular} color="text-zinc-600" />
      </div>

      {/* Actions bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени, email, телефону..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 pl-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <CreateUserForm onUserCreated={() => fetchUsers(search || undefined)} />
      </div>

      {/* Users table */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h2 className="font-semibold text-zinc-900">
            Список пользователей
            {search && (
              <span className="ml-2 text-sm font-normal text-zinc-400">
                найдено: {users.length}
              </span>
            )}
          </h2>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">Загрузка...</div>
          ) : users.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">
              {search ? "Ничего не найдено" : "Нет пользователей"}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-zinc-500">
                  <th className="px-6 py-3 font-medium">Пользователь</th>
                  <th className="px-6 py-3 font-medium">Контакты</th>
                  <th className="px-6 py-3 font-medium">Вход через</th>
                  <th className="px-6 py-3 font-medium">Роль</th>
                  <th className="px-6 py-3 font-medium">Регистрация</th>
                  <th className="px-6 py-3 font-medium text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-50/50 transition-colors">
                    {/* User info */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        {user.image ? (
                          <img
                            src={user.image}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600">
                            {(user.name || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-zinc-900">
                          {user.name || "Без имени"}
                        </span>
                      </div>
                    </td>

                    {/* Contacts */}
                    <td className="px-6 py-3">
                      <div className="space-y-0.5">
                        {user.email && (
                          <div className="text-zinc-600">{user.email}</div>
                        )}
                        {user.phone && (
                          <div className="text-zinc-400 text-xs">{user.phone}</div>
                        )}
                        {!user.email && !user.phone && (
                          <span className="text-zinc-300">—</span>
                        )}
                      </div>
                    </td>

                    {/* Auth providers */}
                    <td className="px-6 py-3">
                      <AuthProviderBadges providers={user.authProviders} />
                    </td>

                    {/* Role */}
                    <td className="px-6 py-3">
                      {editingRole === user.id ? (
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue={user.role}
                            disabled={savingRole === user.id}
                            onChange={(e) =>
                              handleRoleChange(user.id, e.target.value as Role)
                            }
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="USER">Пользователь</option>
                            <option value="MANAGER">Менеджер</option>
                            <option value="SUPERADMIN">Суперадмин</option>
                          </select>
                          <button
                            onClick={() => setEditingRole(null)}
                            className="text-xs text-zinc-400 hover:text-zinc-600"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingRole(user.id)}
                          className="group flex items-center gap-1.5"
                          title="Нажмите для изменения роли"
                        >
                          <Badge variant={roleVariant[user.role]}>
                            {roleLabel[user.role]}
                          </Badge>
                          <svg
                            className="h-3 w-3 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                      )}
                    </td>

                    {/* Created at */}
                    <td className="px-6 py-3 text-zinc-400">
                      {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(user.role === "SUPERADMIN" || user.role === "MANAGER") && (
                          <ReleaseNotifyToggle
                            enabled={user.notificationPreference?.notifyReleases ?? false}
                            loading={togglingRelease === user.id}
                            hasTelegram={!!user.telegramId}
                            onClick={() => handleReleaseNotifyToggle(user)}
                          />
                        )}
                        {user.email && (
                          <button
                            onClick={() => setResetPasswordUser(user)}
                            className="rounded-lg border border-orange-200 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 transition-colors"
                            title="Сбросить пароль"
                          >
                            Пароль
                          </button>
                        )}
                        <button
                          onClick={() => setPermissionsUser(user)}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                          title="Управление правами доступа"
                        >
                          Права
                        </button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={deleting === user.id}
                          onClick={() => handleDelete(user.id)}
                        >
                          {deleting === user.id ? "..." : "Удалить"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-zinc-500">
            Показано {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} из {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { const p = page - 1; setPage(p); fetchUsers(search || undefined, p); }}
              disabled={page === 0}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              Назад
            </button>
            <button
              onClick={() => { const p = page + 1; setPage(p); fetchUsers(search || undefined, p); }}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              Далее
            </button>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {permissionsUser && (
        <PermissionsModal
          userId={permissionsUser.id}
          userName={permissionsUser.name}
          userRole={permissionsUser.role}
          onClose={() => setPermissionsUser(null)}
          onSaved={() => fetchUsers(search || undefined)}
        />
      )}

      {/* Reset Password Modal */}
      {resetPasswordUser && (
        <ResetPasswordModal
          userId={resetPasswordUser.id}
          userName={resetPasswordUser.name}
          userEmail={resetPasswordUser.email}
          onClose={() => setResetPasswordUser(null)}
        />
      )}
    </div>
  );
}

function ResetPasswordModal({
  userId,
  userName,
  userEmail,
  onClose,
}: {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        setDone(true);
      } else {
        setError(data.error?.message || "Ошибка сброса пароля");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Сброс пароля</h2>
            <p className="text-sm text-zinc-500">
              {userName || "Без имени"} · {userEmail}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4">
          {done ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
              Пароль успешно обновлён. Пользователь может войти с новым паролем.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700">Новый пароль</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                  className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Минимум 6 символов"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving || password.length < 6}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Сохранение..." : "Установить пароль"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
        {done && (
          <div className="flex justify-end border-t border-zinc-200 px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
            >
              Закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReleaseNotifyToggle({
  enabled,
  loading,
  hasTelegram,
  onClick,
}: {
  enabled: boolean;
  loading: boolean;
  hasTelegram: boolean;
  onClick: () => void;
}) {
  const title = !hasTelegram
    ? "Telegram не привязан — нотификации недоступны"
    : enabled
    ? "Нотификации о релизах включены. Нажмите для отключения"
    : "Включить нотификации о релизах в Telegram";

  return (
    <button
      onClick={onClick}
      disabled={loading || !hasTelegram}
      title={title}
      className={[
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
        loading ? "opacity-50 cursor-wait" : "",
        !hasTelegram
          ? "border-zinc-200 text-zinc-300 cursor-not-allowed"
          : enabled
          ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-zinc-300 text-zinc-500 hover:bg-zinc-50",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Bell icon */}
      <svg
        className="h-3.5 w-3.5"
        fill={enabled && hasTelegram ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      {loading ? "..." : enabled ? "Релизы" : "Релизы"}
    </button>
  );
}

function StatCard({
  label,
  value,
  color = "text-zinc-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
