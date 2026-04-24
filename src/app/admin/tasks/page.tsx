import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TaskBoard } from "@/components/admin/tasks/task-board";
import { CreateTaskButton } from "@/components/admin/tasks/create-task-button";
import { TaskFilters } from "@/components/admin/tasks/task-filters";
import type { TaskStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  type?: string;
  status?: string;
  assignee?: string;
  q?: string;
  tab?: string;
}>;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user || session.user.role === "USER") {
    redirect("/admin/forbidden");
  }

  const params = await searchParams;
  const tab = params.tab ?? "board"; // board | mine | issues
  const typeFilter = params.type === "ISSUE" || tab === "issues" ? "ISSUE" : undefined;

  const where: Record<string, unknown> = {};
  if (typeFilter) where.type = typeFilter;
  if (params.status) where.status = params.status;

  if (tab === "mine") {
    where.OR = [
      { assigneeUserId: session.user.id },
      { reporterUserId: session.user.id },
    ];
  } else if (session.user.role === "MANAGER") {
    const myCats = await prisma.taskCategory.findMany({
      where: { defaultAssigneeUserId: session.user.id },
      select: { id: true },
    });
    const categoryIds = myCats.map((c) => c.id);
    const visibility: Array<Record<string, unknown>> = [
      { assigneeUserId: session.user.id },
      { reporterUserId: session.user.id },
    ];
    if (categoryIds.length > 0) {
      visibility.push({ categoryId: { in: categoryIds }, type: "ISSUE" });
    }
    where.OR = visibility;
  }

  if (params.q) {
    const q = params.q.trim();
    where.AND = [
      {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { publicId: { contains: q.toUpperCase(), mode: "insensitive" } },
        ],
      },
    ];
  }

  const [tasks, categories, assignees] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        assignee: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
        externalOffice: { select: { id: true, number: true, building: true } },
        externalTenant: { select: { id: true, companyName: true } },
        _count: { select: { comments: true } },
      },
    }),
    prisma.taskCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManageCategories = session.user.role === "SUPERADMIN";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Задачи</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Трекер задач команды и жалоб от арендаторов
        </p>
      </div>

      <div className="flex items-center gap-3 border-b border-zinc-200">
        <TabLink tab="board" current={tab} label="Канбан" />
        <TabLink tab="mine" current={tab} label="Мои задачи" />
        <TabLink tab="issues" current={tab} label="Жалобы арендаторов" />
        <div className="ml-auto flex items-center gap-2 py-2">
          {canManageCategories && (
            <Link
              href="/admin/tasks/categories"
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Категории
            </Link>
          )}
          <CreateTaskButton categories={categories} assignees={assignees} />
        </div>
      </div>

      <TaskFilters categories={categories} assignees={assignees} />

      <TaskBoard
        tasks={tasks.map((t) => ({
          id: t.id,
          publicId: t.publicId,
          title: t.title,
          status: t.status,
          priority: t.priority,
          type: t.type,
          assignee: t.assignee,
          category: t.category,
          externalOffice: t.externalOffice,
          externalTenant: t.externalTenant,
          commentsCount: t._count.comments,
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          labels: t.labels,
        }))}
      />
    </div>
  );
}

function TabLink({
  tab,
  current,
  label,
}: {
  tab: string;
  current: string;
  label: string;
}) {
  const isActive = current === tab;
  return (
    <Link
      href={`/admin/tasks?tab=${tab}`}
      className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        isActive
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      {label}
    </Link>
  );
}
