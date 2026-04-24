"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";

export type TaskCard = {
  id: string;
  publicId: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  assignee: { id: string; name: string | null; email: string | null } | null;
  category: { id: string; name: string; slug: string } | null;
  externalOffice: { id: string; number: string; building: number | null } | null;
  externalTenant: { id: string; companyName: string } | null;
  commentsCount: number;
  dueDate: string | null;
  labels: string[];
};

const COLUMNS: Array<{ id: string; label: string; bg: string }> = [
  { id: "BACKLOG",     label: "Бэклог",         bg: "bg-zinc-50" },
  { id: "TODO",        label: "К выполнению",   bg: "bg-blue-50/50" },
  { id: "IN_PROGRESS", label: "В работе",       bg: "bg-amber-50/60" },
  { id: "IN_REVIEW",   label: "На проверке",    bg: "bg-violet-50/60" },
  { id: "BLOCKED",     label: "Заблокировано",  bg: "bg-red-50/60" },
  { id: "DONE",        label: "Готово",         bg: "bg-green-50/60" },
  { id: "CANCELLED",   label: "Отменено",       bg: "bg-zinc-100" },
];

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-zinc-100 text-zinc-600",
  MEDIUM: "bg-blue-100 text-blue-700",
  HIGH: "bg-amber-100 text-amber-800",
  URGENT: "bg-red-100 text-red-700",
};

export function TaskBoard({ tasks }: { tasks: TaskCard[] }) {
  const router = useRouter();
  const [items, setItems] = useState<TaskCard[]>(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const byColumn = useMemo(() => {
    const map: Record<string, TaskCard[]> = {};
    for (const col of COLUMNS) map[col.id] = [];
    for (const t of items) {
      (map[t.status] ??= []).push(t);
    }
    return map;
  }, [items]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const taskId = String(active.id);
      const newStatus = String(over.id);
      const task = items.find((t) => t.id === taskId);
      if (!task || task.status === newStatus) return;
      if (!COLUMNS.some((c) => c.id === newStatus)) return;

      // Optimistic update
      setItems((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );

      try {
        const res = await fetch(`/api/tasks/${task.publicId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Не удалось обновить статус");
        router.refresh();
      } catch (err) {
        console.error(err);
        // Revert
        setItems((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t))
        );
        alert("Не удалось обновить статус. Попробуйте ещё раз.");
      }
    },
    [items, router]
  );

  const activeTask = activeId ? items.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <Column key={col.id} id={col.id} label={col.label} bg={col.bg} count={byColumn[col.id].length}>
            {byColumn[col.id].map((task) => (
              <DraggableCard key={task.id} task={task} />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="w-72 rotate-1 shadow-lg">
            <CardInner task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  id,
  label,
  bg,
  count,
  children,
}: {
  id: string;
  label: string;
  bg: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-lg border border-zinc-200 ${bg} ${
        isOver ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-zinc-200/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <span>{label}</span>
        <span className="rounded bg-white/70 px-1.5 text-zinc-600">{count}</span>
      </div>
      <div className="flex flex-col gap-2 p-2">{children}</div>
    </div>
  );
}

function DraggableCard({ task }: { task: TaskCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardInner task={task} />
    </div>
  );
}

function CardInner({ task }: { task: TaskCard }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <Link
          href={`/admin/tasks/${task.publicId}`}
          className="text-xs font-mono text-zinc-400 hover:text-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          {task.publicId}
        </Link>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.MEDIUM
          }`}
        >
          {task.priority}
        </span>
      </div>
      <p className="mb-2 text-sm font-medium text-zinc-900">{task.title}</p>
      {task.type === "ISSUE" && (task.externalOffice || task.externalTenant) && (
        <p className="mb-1 text-xs text-zinc-500">
          {task.externalTenant?.companyName}
          {task.externalOffice ? ` · офис ${task.externalOffice.number}` : ""}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="truncate">
          {task.assignee?.name ?? task.assignee?.email ?? "Без исполнителя"}
        </span>
        {task.commentsCount > 0 && <span>💬 {task.commentsCount}</span>}
      </div>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span
              key={l}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
