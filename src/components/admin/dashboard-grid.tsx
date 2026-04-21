"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export type DashboardCard = {
  id: string;
  node: ReactNode;
};

type Props = {
  storageKey: string;
  cards: DashboardCard[];
  className?: string;
};

function loadOrder(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((i) => typeof i === "string")) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function saveOrder(key: string, order: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // ignore
  }
}

function SortableItem({
  id,
  editing,
  children,
}: {
  id: string;
  editing: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editing && (
        <button
          {...attributes}
          {...listeners}
          aria-label="Перетащить карточку"
          className="absolute top-2 right-2 z-10 flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200 hover:text-zinc-900 active:cursor-grabbing touch-none backdrop-blur"
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5" />
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="3" cy="13" r="1.5" />
            <circle cx="9" cy="3" r="1.5" />
            <circle cx="9" cy="8" r="1.5" />
            <circle cx="9" cy="13" r="1.5" />
          </svg>
        </button>
      )}
      <div className={editing ? "pointer-events-none select-none ring-1 ring-dashed ring-blue-300 rounded-xl" : ""}>
        {children}
      </div>
    </div>
  );
}

export function DashboardGrid({ storageKey, cards, className }: Props) {
  const defaultOrder = cards.map((c) => c.id);
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setOrder(loadOrder(storageKey, defaultOrder));
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Reconcile: drop missing, append new
  useEffect(() => {
    if (!mounted) return;
    const known = new Set(defaultOrder);
    const filtered = order.filter((id) => known.has(id));
    const missing = defaultOrder.filter((id) => !order.includes(id));
    const next = [...filtered, ...missing];
    if (next.length !== order.length || next.some((id, i) => id !== order[i])) {
      setOrder(next);
      saveOrder(storageKey, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, defaultOrder.join("|")]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setOrder((prev) => {
        const oldIdx = prev.indexOf(String(active.id));
        const newIdx = prev.indexOf(String(over.id));
        if (oldIdx === -1 || newIdx === -1) return prev;
        const next = arrayMove(prev, oldIdx, newIdx);
        saveOrder(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const reset = useCallback(() => {
    setOrder(defaultOrder);
    saveOrder(storageKey, defaultOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, defaultOrder.join("|")]);

  const byId = Object.fromEntries(cards.map((c) => [c.id, c.node]));
  const active = activeId ? byId[activeId] : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {editing && (
          <button
            onClick={reset}
            className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            title="Сбросить порядок"
          >
            ↺ Сбросить
          </button>
        )}
        <button
          onClick={() => setEditing((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
            editing
              ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
              : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
          }`}
          title={editing ? "Готово" : "Настроить карточки"}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 2l3 3-9 9H2v-3l9-9z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {editing ? "Готово" : "Настроить"}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className={className} style={{ visibility: mounted ? "visible" : "hidden" }}>
            {order.map((id) => {
              const node = byId[id];
              if (!node) return null;
              return (
                <SortableItem key={id} id={id} editing={editing}>
                  {node}
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {active ? (
            <div className="opacity-90 shadow-xl rounded-xl">{active}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
