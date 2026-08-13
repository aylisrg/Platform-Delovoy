"use client";

import { useState } from "react";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { useTelegram } from "./TelegramProvider";
import { Button, Card, Icon } from "./ui";

interface BookingConfirmProps {
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  pricePerHour?: number | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Иконка ресурса вместо эмодзи (AC-7.3). */
  icon?: WebAppIconName;
}

function formatDateRu(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const weekdays = [
    "воскресенье", "понедельник", "вторник", "среда",
    "четверг", "пятница", "суббота",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}, ${weekdays[d.getDay()]}`;
}

function computeHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em - sh * 60 - sm) / 60;
}

export function BookingConfirm({
  resourceName,
  date,
  startTime,
  endTime,
  pricePerHour,
  onConfirm,
  onCancel,
  icon = "calendar",
}: BookingConfirmProps) {
  const { haptic } = useTelegram();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hours = computeHours(startTime, endTime);
  const total = pricePerHour ? pricePerHour * hours : null;

  const handleConfirm = async () => {
    haptic.impact("medium");
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      haptic.notification("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка бронирования");
      haptic.notification("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-6 tg-page-enter">
      <h2 className="text-[22px] font-bold text-center">Подтвердите бронь</h2>

      <Card className="mt-6">
        {/* Resource */}
        <div className="p-4 flex items-center gap-3">
          <span
            className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0"
            style={{
              background: "var(--tg-secondary-bg)",
              color: "var(--tg-accent)",
            }}
          >
            <Icon name={icon} size={24} />
          </span>
          <div className="min-w-0">
            <p className="text-[17px] font-semibold truncate">{resourceName}</p>
            <p className="text-[14px]" style={{ color: "var(--tg-subtitle)" }}>
              Бизнес-парк «Деловой»
            </p>
          </div>
        </div>

        <div style={{ borderTop: "0.5px solid var(--tg-separator)" }} />

        {/* Details */}
        <div className="p-4 space-y-3 text-[15px]">
          <div className="flex justify-between gap-4">
            <span style={{ color: "var(--tg-hint)" }}>Дата</span>
            <span className="font-medium text-right">{formatDateRu(date)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: "var(--tg-hint)" }}>Время</span>
            <span className="font-medium">
              {startTime} — {endTime}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: "var(--tg-hint)" }}>Длительность</span>
            <span className="font-medium">{hours} ч.</span>
          </div>
          {total !== null && (
            <div
              className="pt-3 flex justify-between items-center gap-4"
              style={{ borderTop: "0.5px solid var(--tg-separator)" }}
            >
              <span className="font-semibold">Итого</span>
              <span className="text-[19px] font-bold">
                {total.toLocaleString("ru-RU")} ₽
              </span>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <Card className="mt-4 p-3">
          <div
            className="flex items-start gap-2 text-[14px] font-medium"
            style={{ color: "var(--tg-destructive)" }}
          >
            <span className="shrink-0 mt-0.5">
              <Icon name="alert" size={18} />
            </span>
            <span>{error}</span>
          </div>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        <Button onClick={handleConfirm} disabled={loading}>
          {loading ? "Бронируем..." : "Забронировать"}
        </Button>

        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => {
            haptic.impact("light");
            onCancel();
          }}
        >
          Назад
        </Button>
      </div>
    </div>
  );
}
