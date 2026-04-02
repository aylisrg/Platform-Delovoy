import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

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

export default async function UsersPage() {
  let users: Array<{ id: string; name: string | null; email: string | null; role: Role; createdAt: Date }> = [];

  try {
    users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch {
    // DB may not be available yet
  }

  return (
    <>
      <AdminHeader title="Пользователи" />
      <div className="p-8">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Список пользователей</h2>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет пользователей. Запустите seed: <code className="bg-zinc-100 px-1 py-0.5 rounded text-xs">npm run db:seed</code></p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Имя</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Роль</th>
                    <th className="pb-3 font-medium">Регистрация</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-zinc-50">
                      <td className="py-3 text-zinc-900">{user.name ?? "—"}</td>
                      <td className="py-3 text-zinc-600">{user.email ?? "—"}</td>
                      <td className="py-3">
                        <Badge variant={roleVariant[user.role]}>{roleLabel[user.role]}</Badge>
                      </td>
                      <td className="py-3 text-zinc-400">
                        {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
