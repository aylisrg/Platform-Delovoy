"use client";

import { useTelegram } from "./TelegramProvider";

interface BookingCardProps {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  onCancel?: (id: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Ожидает", color: "#f59e0b", bg: "#fef3c7" },
  CONFIRMED: { label: "Подтверждена", color: "#16a34a", bg: "#dcfce7" },
  CHECKED_IN: { label: "Заселён", color: "#2563eb", bg: "#dbeafe" },
  COMPLETED: { label: "Завершена", color: "#6b7280", bg: "#f3f4f6" },
  CANCELLED: { label: "Отменена", color: "#dc2626", bg: "#fef2f2" },
  NO_SHOW: { label: "Неявка", color: "#dc2626", bg: "#fef2f2" },
};

const MODULE_ICONS: Record<string, string> = {
  gazebos: "🏕",
  "ps-park": "🎮",
};

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const months = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function BookingCard({
  id,
  moduleSlug,
  resourceName,
  date,
  startTime,
  endTime,
  status,
  onCancel,
}: BookingCardProps) {
  const { haptic } = useTelegram();
  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.PENDING;
  const icon = MODULE_ICONS[moduleSlug] || "📅";
  const canCancel = status === "PENDING" || status === "CONFIRMED";

  return (
    <div className="tg-card p-4" style={{ background: "var(--tg-secondary-bg)" }}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: "var(--tg-bg)" }}
        >
          {icon}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[16px] font-semibold truncate">{resourceName}</h3>
            <span
              className="tg-badge flex-shrink-0"
              style={{ background: statusInfo.bg, color: statusInfo.color }}
            >
              {statusInfo.label}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-3 text-[14px]" style={{ color: "var(--tg-hint)" }}>
            <span>{formatDateShort(date)}</span>
            <span>{startTime} — {endTime}</span>
          </div>
        </div>
      </div>

      {/* Cancel button */}
      {canCancel && onCancel && (
        <button
          onClick={() => {
            haptic.impact("medium");
            onCancel(id);
          }}
          className="mt-3 w-full py-2 rounded-xl text-[14px] font-medium transition-opacity active:opacity-70"
          style={{ background: "#fef2f2", color: "#dc2626" }}
        >
          Отменить бронь
        </button>
      )}
    </div>
  );
}
