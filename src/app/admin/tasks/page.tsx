import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAdminSectionAccess, hasRole } from "@/lib/permissions";
import { listBoards, listCategories } from "@/modules/tasks/board-service";
import { prisma } from "@/lib/db";
import KanbanBoard from "./kanban-board";

export const metadata = { title: "Задачи — Деловой Парк" };

export default async function AdminTasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const user = session.user;
  if (!hasRole(user, "ADMIN")) {
    const ok = await hasAdminSectionAccess(user.id, "tasks");
    if (!ok) redirect("/admin/forbidden");
  }

  const [boards, categories] = await Promise.all([listBoards(), listCategories()]);
  if (boards.length === 0) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Задачи</h1>
        <p className="text-sm text-gray-600">
          Доска не настроена. Запустите seed: <code>npx tsx scripts/seed-tasks.ts</code>.
        </p>
      </div>
    );
  }
  const board = boards.find((b) => b.isDefault) ?? boards[0];

  const tasks = await prisma.task.findMany({
    where: { boardId: board.id, deletedAt: null },
    include: {
      category: true,
      assignees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: [{ columnId: "asc" }, { sortOrder: "asc" }],
  });

  return (
    <KanbanBoard
      board={board}
      tasks={tasks.map((t) => ({
        id: t.id,
        publicId: t.publicId,
        title: t.title,
        priority: t.priority,
        labels: t.labels,
        columnId: t.columnId,
        sortOrder: t.sortOrder,
        category: t.category ? { name: t.category.name, color: t.category.color } : null,
        assignees: t.assignees.map((a) => ({
          userId: a.userId,
          role: a.role,
          name: a.user.name,
        })),
      }))}
      categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
    />
  );
}
