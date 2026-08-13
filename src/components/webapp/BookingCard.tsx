"use client";

import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { useTelegram } from "./TelegramProvider";
import { Badge, Button, Card, Icon } from "./ui";

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

type StatusTone = "accent" | "success" | "warning" | "destructive" | "neutral";

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Ожидает", tone: "warning" },
  CONFIRMED: { label: "Подтверждена", tone: "success" },
  CHECKED_IN: { label: "Вы на месте", tone: "accent" },
  COMPLETED: { label: "Завершена", tone: "neutral" },
  CANCELLED: { label: "Отменена", tone: "destructive" },
  NO_SHOW: { label: "Неявка", tone: "destructive" },
};

const MODULE_ICONS: Record<string, WebAppIconName> = {
  gazebos: "tent",
  "ps-park": "gamepad",
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
  const icon: WebAppIconName = MODULE_ICONS[moduleSlug] || "calendar";
  const canCancel = status === "PENDING" || status === "CONFIRMED";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {/* Иконка модуля — из единого набора, без эмодзи (AC-7.3) */}
        <span
          className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
          style={{
            background: "var(--tg-secondary-bg)",
            color: "var(--tg-accent)",
          }}
        >
          <Icon name={icon} size={22} />
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[16px] font-semibold truncate">{resourceName}</h3>
            <span className="shrink-0">
              <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
            </span>
          </div>

          <div
            className="mt-1.5 flex items-center gap-3 text-[14px]"
            style={{ color: "var(--tg-subtitle)" }}
          >
            <span className="inline-flex items-center gap-1">
              <Icon name="calendar" size={14} />
              {formatDateShort(date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={14} />
              {startTime} — {endTime}
            </span>
          </div>
        </div>
      </div>

      {/* Cancel button */}
      {canCancel && onCancel && (
        <div className="mt-3">
          <Button
            variant="destructive"
            style={{ fontSize: 15, paddingTop: 10, paddingBottom: 10 }}
            onClick={() => {
              haptic.impact("medium");
              onCancel(id);
            }}
          >
            Отменить бронь
          </Button>
        </div>
      )}
    </Card>
  );
}
