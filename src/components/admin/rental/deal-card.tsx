"use client";

import { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import type { DealPriority, DealSource } from "@/modules/rental/types";

export type DealCardData = {
  id: string;
  contactName: string;
  phone: string;
  email: string | null;
  companyName: string | null;
  stage: string;
  priority: DealPriority;
  source: DealSource;
  desiredArea: string | null;
  budget: string | null;
  moveInDate: string | null;
  requirements: string | null;
  officeId: string | null;
  office: {
    id: string;
    number: string;
    floor: number;
    building: number;
    area: number;
    pricePerMonth: number;
  } | null;
  inquiryId: string | null;
  tenantId: string | null;
  contractId: string | null;
  dealValue: number | null;
  nextActionDate: string | null;
  nextAction: string | null;
  lostReason: string | null;
  adminNotes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const priorityConfig: Record<DealPriority, { label: string; variant: "danger" | "warning" | "default"; dot: string }> = {
  HOT: { label: "Hot", variant: "danger", dot: "bg-red-500" },
  WARM: { label: "Warm", variant: "warning", dot: "bg-amber-500" },
  COLD: { label: "Cold", variant: "default", dot: "bg-blue-400" },
};

const sourceLabels: Record<DealSource, string> = {
  WEBSITE: "Сайт",
  PHONE: "Звонок",
  WALK_IN: "Визит",
  REFERRAL: "Рекомендация",
  AVITO: "Авито",
  CIAN: "ЦИАН",
  OTHER: "Другое",
};

type Props = {
  deal: DealCardData;
  now: number;
  onEdit: (deal: DealCardData) => void;
  overlay?: boolean;
};

export function DealCard({ deal, now, onEdit, overlay }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: deal.id,
    data: { type: "deal", deal },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const prio = priorityConfig[deal.priority];

  const { isOverdue, daysAgo } = useMemo(() => ({
    isOverdue: deal.nextActionDate
      ? new Date(deal.nextActionDate).getTime() < now
      : false,
    daysAgo: Math.floor(
      (now - new Date(deal.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    ),
  }), [deal.nextActionDate, deal.createdAt, now]);

  return (
    <div
      ref={setNodeRef}
      style={overlay ? undefined : style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(deal)}
      className={`group relative rounded-lg border bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md ${
        isDragging ? "shadow-lg ring-2 ring-blue-300" : ""
      } ${overlay ? "shadow-xl ring-2 ring-blue-400 rotate-2" : ""}`}
    >
      {/* Priority dot + Source */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${prio.dot}`} />
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 font-medium">
            {sourceLabels[deal.source]}
          </span>
        </div>
        {deal.dealValue && (
          <span className="text-xs font-semibold text-green-700">
            {Number(deal.dealValue).toLocaleString("ru-RU")} ₽
          </span>
        )}
      </div>

      {/* Contact */}
      <p className="font-medium text-sm text-zinc-900 leading-tight">
        {deal.contactName}
      </p>
      {deal.companyName && (
        <p className="text-xs text-zinc-500 mt-0.5">{deal.companyName}</p>
      )}

      {/* Office */}
      {deal.office && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700">
            K{deal.office.building}-{deal.office.number}
          </span>
          <span>{Number(deal.office.area)} m²</span>
        </div>
      )}

      {/* Requirements snippet */}
      {(deal.desiredArea || deal.budget) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deal.desiredArea && (
            <span className="text-[10px] rounded bg-violet-50 text-violet-700 px-1.5 py-0.5">
              {deal.desiredArea}
            </span>
          )}
          {deal.budget && (
            <span className="text-[10px] rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5">
              {deal.budget}
            </span>
          )}
        </div>
      )}

      {/* Next action */}
      {deal.nextAction && (
        <div
          className={`mt-2 text-xs rounded px-2 py-1 ${
            isOverdue
              ? "bg-red-50 text-red-700"
              : "bg-blue-50 text-blue-700"
          }`}
        >
          <span className="font-medium">
            {deal.nextActionDate
              ? new Date(deal.nextActionDate).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                })
              : ""}
          </span>{" "}
          {deal.nextAction}
        </div>
      )}

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">
          {daysAgo === 0 ? "сегодня" : `${daysAgo} дн. назад`}
        </span>
        <Badge variant={prio.variant} className="text-[10px] px-1.5 py-0">
          {prio.label}
        </Badge>
      </div>
    </div>
  );
}

export function DealCardOverlay({ deal, now }: { deal: DealCardData; now: number }) {
  return <DealCard deal={deal} now={now} onEdit={() => {}} overlay />;
}
