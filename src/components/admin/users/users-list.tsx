"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateUserForm } from "./create-user-form";

type Role = "SUPERADMIN" | "MANAGER" | "USER";

interface User {
  id: string;
  name: string | null;
  email: string | null;
  role: Role;
  phone: string | null;
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

export function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
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

  return (
    <div className="space-y-6">
      <CreateUserForm onUserCreated={fetchUsers} />

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h2 className="font-semibold text-zinc-900">Список пользователей</h2>
        </div>
        <div className="px-6 py-4">
          {loading ? (
            <p className="text-sm text-zinc-400">Загрузка...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Нет пользователей. Создайте первого пользователя выше.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-zinc-500">
                  <th className="pb-3 font-medium">Имя</th>
                  <th className="pb-3 font-medium">Email</th>
                  <th className="pb-3 font-medium">Телефон</th>
                  <th className="pb-3 font-medium">Роль</th>
                  <th className="pb-3 font-medium">Регистрация</th>
                  <th className="pb-3 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-zinc-50">
                    <td className="py-3 text-zinc-900">{user.name ?? "—"}</td>
                    <td className="py-3 text-zinc-600">{user.email ?? "—"}</td>
                    <td className="py-3 text-zinc-600">{user.phone ?? "—"}</td>
                    <td className="py-3">
                      <Badge variant={roleVariant[user.role]}>
                        {roleLabel[user.role]}
                      </Badge>
                    </td>
                    <td className="py-3 text-zinc-400">
                      {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="py-3">
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
