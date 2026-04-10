"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateUserForm } from "./create-user-form";
import { PermissionsModal } from "./permissions-modal";

type Role = "SUPERADMIN" | "MANAGER" | "USER";

interface User {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  createdAt: string;
}

const roleVariant: Record<Role, "danger" | "warning" | "default"> = {
  SUPERADMIN: "danger",
  MANAGER: "warning",
  USER: "default",
};

const roleLabel: Record<Role, string> = {
  SUPERADMIN: "Суперадмин",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

function getAuthProvider(user: User): string {
  if (user.telegramId) return "Telegram";
  if (user.email?.includes("@")) return "Email";
  return "—";
}

export function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const fetchUsers = useCallback(async (searchQuery?: string) => {
    try {
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : "";
      const res = await fetch(`/api/users${params}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers(search || undefined);
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

                    {/* Auth provider */}
                    <td className="px-6 py-3">
                      <span className="text-xs text-zinc-400">
                        {getAuthProvider(user)}
                      </span>
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
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleting === user.id}
                        onClick={() => handleDelete(user.id)}
                      >
                        {deleting === user.id ? "..." : "Удалить"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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
