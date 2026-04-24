import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTaskByPublicId } from "@/modules/tasks/service";
import { TaskDetail } from "@/components/admin/tasks/task-detail";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role === "USER") {
    redirect("/admin/forbidden");
  }

  const { publicId } = await params;
  const task = await getTaskByPublicId(publicId);
  if (!task) return notFound();

  // RBAC: manager sees only their visible tasks
  if (session.user.role === "MANAGER") {
    const myCats = await prisma.taskCategory.findMany({
      where: { defaultAssigneeUserId: session.user.id },
      select: { id: true },
    });
    const myCatIds = myCats.map((c: { id: string }) => c.id);
    const canSee =
      task.assigneeUserId === session.user.id ||
      task.reporterUserId === session.user.id ||
      (task.type === "ISSUE" &&
        !!task.categoryId &&
        myCatIds.includes(task.categoryId));
    if (!canSee) redirect("/admin/forbidden");
  }

  const assignees = await prisma.user.findMany({
    where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const canReassign =
    session.user.role === "SUPERADMIN" || session.user.role === "ADMIN";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <Link
        href="/admin/tasks"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← К задачам
      </Link>
      <TaskDetail
        task={{
          id: task.id,
          publicId: task.publicId,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          type: task.type,
          labels: task.labels,
          dueDate: task.dueDate ? task.dueDate.toISOString() : null,
          category: task.category,
          assignee: task.assignee,
          reporter: task.reporter,
          externalOffice: task.externalOffice,
          externalTenant: task.externalTenant,
          externalContact: task.externalContact as Record<string, unknown> | null,
          comments: task.comments.map((c: (typeof task.comments)[number]) => ({
            id: c.id,
            body: c.body,
            source: c.source,
            createdAt: c.createdAt.toISOString(),
            author: c.author,
            authorExternal: c.authorExternal as Record<string, unknown> | null,
          })),
          events: task.events.map((e: (typeof task.events)[number]) => ({
            id: e.id,
            kind: e.kind,
            metadata: e.metadata as Record<string, unknown> | null,
            createdAt: e.createdAt.toISOString(),
          })),
        }}
        assignees={assignees}
        canReassign={canReassign}
      />
    </div>
  );
}
