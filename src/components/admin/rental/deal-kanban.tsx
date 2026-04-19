"use client";

import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { DealCard, DealCardOverlay, type DealCardData } from "./deal-card";
import { DealModal } from "./deal-modal";
import { Button } from "@/components/ui/button";
import type { DealStage } from "@/modules/rental/types";

type OfficeOption = {
  id: string;
  number: string;
  floor: number;
  building: number;
  area: number;
  pricePerMonth: number;
  status: string;
};

type Props = {
  initialDeals: DealCardData[];
  offices: OfficeOption[];
  now: number;
};

type StageConfig = {
  id: DealStage;
  label: string;
  color: string;
  bgColor: string;
};

const STAGES: StageConfig[] = [
  { id: "NEW_LEAD", label: "Новые", color: "bg-zinc-500", bgColor: "bg-zinc-50" },
  { id: "QUALIFICATION", label: "Квалификация", color: "bg-blue-500", bgColor: "bg-blue-50/50" },
  { id: "SHOWING", label: "Показ", color: "bg-violet-500", bgColor: "bg-violet-50/50" },
  { id: "PROPOSAL", label: "КП", color: "bg-amber-500", bgColor: "bg-amber-50/50" },
  { id: "NEGOTIATION", label: "Переговоры", color: "bg-orange-500", bgColor: "bg-orange-50/50" },
  { id: "CONTRACT_DRAFT", label: "Договор", color: "bg-cyan-500", bgColor: "bg-cyan-50/50" },
  { id: "WON", label: "Выиграно", color: "bg-green-500", bgColor: "bg-green-50/50" },
  { id: "LOST", label: "Проиграно", color: "bg-red-500", bgColor: "bg-red-50/30" },
];

export function DealKanban({ initialDeals, offices, now }: Props) {
  const router = useRouter();
  const [deals, setDeals] = useState<DealCardData[]>(initialDeals);
  const [activeDeal, setActiveDeal] = useState<DealCardData | null>(null);
  const [editDeal, setEditDeal] = useState<DealCardData | null>(null);
  const [createStage, setCreateStage] = useState<DealStage | null>(null);
  const [showModal, setShowModal] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const dealsByStage = useMemo(() => {
    const map: Record<string, DealCardData[]> = {};
    for (const stage of STAGES) {
      map[stage.id] = deals
        .filter((d) => d.stage === stage.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [deals]);

  const findStage = useCallback(
    (id: string): DealStage | null => {
      // Is it a stage id?
      if (STAGES.some((s) => s.id === id)) return id as DealStage;
      // Find which stage contains this deal
      const deal = deals.find((d) => d.id === id);
      return deal ? (deal.stage as DealStage) : null;
    },
    [deals]
  );

  function handleDragStart(event: DragStartEvent) {
    const deal = deals.find((d) => d.id === event.active.id);
    setActiveDeal(deal ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeStage = findStage(String(active.id));
    const overStage = findStage(String(over.id));

    if (!activeStage || !overStage || activeStage === overStage) return;

    setDeals((prev) => {
      const dealIndex = prev.findIndex((d) => d.id === active.id);
      if (dealIndex === -1) return prev;

      const updated = [...prev];
      updated[dealIndex] = { ...updated[dealIndex], stage: overStage };
      return updated;
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDeal(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeStage = findStage(activeId);
    if (!activeStage) return;

    const stageDeals = deals
      .filter((d) => d.stage === activeStage)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const oldIndex = stageDeals.findIndex((d) => d.id === activeId);
    const newIndex = stageDeals.findIndex((d) => d.id === overId);

    let reordered = stageDeals;
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      reordered = arrayMove(stageDeals, oldIndex, newIndex);
    }

    // Build update payload
    const updates = reordered.map((d, idx) => ({
      dealId: d.id,
      newStage: activeStage,
      sortOrder: idx,
    }));

    // Optimistic update
    setDeals((prev) => {
      const otherDeals = prev.filter((d) => d.stage !== activeStage);
      const updatedStageDeals = reordered.map((d, idx) => ({
        ...d,
        stage: activeStage,
        sortOrder: idx,
      }));
      return [...otherDeals, ...updatedStageDeals];
    });

    // Persist
    try {
      await fetch("/api/rental/deals/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    } catch {
      // Revert on failure
      router.refresh();
    }
  }

  function openCreate(stage: DealStage) {
    setCreateStage(stage);
    setEditDeal(null);
    setShowModal(true);
  }

  function openEdit(deal: DealCardData) {
    setEditDeal(deal);
    setCreateStage(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditDeal(null);
    setCreateStage(null);
  }

  // Summary stats
  const totalValue = deals
    .filter((d) => !["WON", "LOST"].includes(d.stage))
    .reduce((sum, d) => sum + (d.dealValue ? Number(d.dealValue) : 0), 0);
  const activeDeals = deals.filter(
    (d) => !["WON", "LOST"].includes(d.stage)
  ).length;
  const wonValue = deals
    .filter((d) => d.stage === "WON")
    .reduce((sum, d) => sum + (d.dealValue ? Number(d.dealValue) : 0), 0);

  return (
    <div>
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">В работе:</span>
          <span className="font-semibold text-zinc-900">{activeDeals}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Потенциал:</span>
          <span className="font-semibold text-zinc-900">
            {totalValue.toLocaleString("ru-RU")} ₽/мес
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Выиграно:</span>
          <span className="font-semibold text-green-700">
            {wonValue.toLocaleString("ru-RU")} ₽/мес
          </span>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => openCreate("NEW_LEAD")}>
            + Новая сделка
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              deals={dealsByStage[stage.id]}
              now={now}
              onAddDeal={() => openCreate(stage.id)}
              onEditDeal={openEdit}
            />
          ))}
        </div>

        <DragOverlay>
          {activeDeal ? <DealCardOverlay deal={activeDeal} now={now} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Modal */}
      {showModal && (
        <DealModal
          deal={editDeal}
          stage={createStage ?? undefined}
          offices={offices}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function KanbanColumn({
  stage,
  deals,
  now,
  onAddDeal,
  onEditDeal,
}: {
  stage: StageConfig;
  deals: DealCardData[];
  now: number;
  onAddDeal: () => void;
  onEditDeal: (deal: DealCardData) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  const totalValue = deals.reduce(
    (sum, d) => sum + (d.dealValue ? Number(d.dealValue) : 0),
    0
  );

  return (
    <div className="flex-shrink-0 w-[280px]">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
        <span className="text-sm font-semibold text-zinc-800">
          {stage.label}
        </span>
        <span className="flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 text-[11px] font-medium w-5 h-5">
          {deals.length}
        </span>
        {totalValue > 0 && (
          <span className="ml-auto text-[11px] text-zinc-400 font-medium">
            {totalValue >= 1000
              ? `${Math.round(totalValue / 1000)}k`
              : totalValue}{" "}
            ₽
          </span>
        )}
      </div>

      {/* Column body */}
      <div
        ref={setNodeRef}
        className={`rounded-xl p-2 min-h-[200px] transition-colors ${
          stage.bgColor
        } ${isOver ? "ring-2 ring-blue-300 bg-blue-50/60" : ""}`}
      >
        <SortableContext
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} now={now} onEdit={onEditDeal} />
            ))}
          </div>
        </SortableContext>

        {/* Add button */}
        {stage.id !== "WON" && stage.id !== "LOST" && (
          <button
            onClick={onAddDeal}
            className="w-full mt-2 py-2 rounded-lg border-2 border-dashed border-zinc-200 text-zinc-400 text-sm hover:border-blue-300 hover:text-blue-500 transition-colors"
          >
            + Добавить
          </button>
        )}
      </div>
    </div>
  );
}
