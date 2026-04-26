import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getTaskByPublicId,
} from "@/modules/tasks/service";
import { listEvents } from "@/modules/tasks/events-service";
import { listComments } from "@/modules/tasks/comments-service";
import { TaskAccessError, TaskNotFoundError } from "@/modules/tasks/access";
import TaskDetailClient from "./task-detail-client";

type Props = { params: Promise<{ publicId: string }> };

export default async function AdminTaskDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const { publicId } = await params;

  try {
    const [task, events, comments] = await Promise.all([
      getTaskByPublicId(publicId, {
        actorUserId: session.user.id,
        actorRole: session.user.role,
      }),
      listEvents(publicId, {
        actorUserId: session.user.id,
        actorRole: session.user.role,
      }),
      listComments(publicId, {
        actorUserId: session.user.id,
        actorRole: session.user.role,
      }),
    ]);
    return (
      <TaskDetailClient
        task={{
          id: task.id,
          publicId: task.publicId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          source: task.source,
          column: { id: task.column.id, name: task.column.name },
          assignees: task.assignees.map((a) => ({
            userId: a.userId,
            role: a.role,
            name: a.user.name,
            email: a.user.email,
          })),
          labels: task.labels,
          createdAt: task.createdAt.toISOString(),
        }}
        events={events.map((e) => ({
          id: e.id,
          kind: e.kind,
          actorName: e.actor?.name ?? null,
          createdAt: e.createdAt.toISOString(),
          metadata: e.metadata,
        }))}
        comments={comments.map((c) => ({
          id: c.id,
          body: c.body,
          authorUserId: c.authorUserId,
          visibleToReporter: c.visibleToReporter,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    );
  } catch (err) {
    if (err instanceof TaskNotFoundError) notFound();
    if (err instanceof TaskAccessError) redirect("/admin/forbidden");
    throw err;
  }
}
