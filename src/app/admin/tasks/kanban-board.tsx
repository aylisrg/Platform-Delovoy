"use client";
import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Link from "next/link";

type Column = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isTerminal: boolean;
  wipLimit: number | null;
};

type Card = {
  id: string;
  publicId: string;
  title: string;
  priority: string;
  labels: string[];
  columnId: string;
  sortOrder: number;
  category: { name: string; color: string } | null;
  assignees: { userId: string; role: string; name: string | null }[];
};

type Props = {
  board: { id: string; name: string; columns: Column[] };
  tasks: Card[];
  categories: { id: string; name: string; color: string }[];
};

export default function KanbanBoard({ board, tasks: initial }: Props) {
  const [tasks, setTasks] = useState<Card[]>(initial);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const grouped = useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const c of board.columns) map[c.id] = [];
    for (const t of tasks) {
      (map[t.columnId] ??= []).push(t);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [tasks, board.columns]);

  async function onDragEnd(e: DragEndEvent) {
    const taskId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const targetColumnId = overId.startsWith("col:") ? overId.slice(4) : null;
    if (!targetColumnId) return;
    const card = tasks.find((t) => t.id === taskId);
    if (!card) return;
    if (card.columnId === targetColumnId) return;

    const previous = tasks;
    setTasks((arr) =>
      arr.map((t) => (t.id === taskId ? { ...t, columnId: targetColumnId } : t))
    );
    try {
      const res = await fetch(`/api/tasks/${card.publicId}/column`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: targetColumnId, sortOrder: Date.now() }),
      });
      if (!res.ok) throw new Error("move failed");
    } catch {
      setTasks(previous);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{board.name}</h1>
        <Link
          href="/admin/tasks/categories"
          className="text-sm text-blue-600 underline"
        >
          Категории
        </Link>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {board.columns.map((col) => (
            <Column key={col.id} column={col} cards={grouped[col.id] ?? []} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ column, cards }: { column: Column; cards: Card[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const overLimit = column.wipLimit !== null && cards.length >= column.wipLimit;
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-shrink-0 flex-col rounded-md border bg-white ${
        isOver ? "border-blue-400" : "border-gray-200"
      }`}
    >
      <header className="border-b border-gray-100 p-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: column.color }}
            />
            {column.name}
          </h2>
          <span
            className={`text-xs ${overLimit ? "font-bold text-red-600" : "text-gray-500"}`}
          >
            {cards.length}
            {column.wipLimit !== null ? `/${column.wipLimit}` : ""}
          </span>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {cards.map((c) => (
          <Card key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

function Card({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="cursor-grab rounded-md border border-gray-200 bg-white p-2 shadow-sm hover:shadow"
    >
      <div className="flex items-center justify-between">
        <Link
          href={`/admin/tasks/${card.publicId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-gray-500"
        >
          {card.publicId}
        </Link>
        {card.priority !== "NONE" && (
          <span
            className={`rounded px-1.5 text-[10px] ${
              card.priority === "CRITICAL"
                ? "bg-red-100 text-red-700"
                : card.priority === "HIGH"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {card.priority}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm">{card.title}</p>
      {card.category && (
        <div className="mt-1">
          <span
            className="inline-block rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: `${card.category.color}33`, color: card.category.color }}
          >
            {card.category.name}
          </span>
        </div>
      )}
      {card.assignees.length > 0 && (
        <div className="mt-1 flex gap-1">
          {card.assignees.slice(0, 3).map((a) => (
            <span
              key={a.userId}
              title={`${a.name ?? "?"} · ${a.role}`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] text-blue-800"
            >
              {(a.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
