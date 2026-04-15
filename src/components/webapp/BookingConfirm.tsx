"use client";

import { useState } from "react";
import { useTelegram } from "./TelegramProvider";

interface BookingConfirmProps {
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  pricePerHour?: number | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
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

      <div className="mt-6 rounded-2xl overflow-hidden" style={{ background: "var(--tg-secondary-bg)" }}>
        {/* Resource */}
        <div className="p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: "var(--tg-bg)" }}>
            {resourceName.includes("PS") || resourceName.includes("Стол") ? "🎮" : "🏕"}
          </div>
          <div>
            <p className="text-[17px] font-semibold">{resourceName}</p>
            <p className="text-[14px]" style={{ color: "var(--tg-hint)" }}>
              Бизнес-парк «Деловой»
            </p>
          </div>
        </div>

        <div style={{ borderTop: "0.5px solid rgba(0,0,0,0.06)" }} />

        {/* Details */}
        <div className="p-4 space-y-3">
          <div className="flex justify-between">
            <span style={{ color: "var(--tg-hint)" }}>Дата</span>
            <span className="font-medium">{formatDateRu(date)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--tg-hint)" }}>Время</span>
            <span className="font-medium">{startTime} — {endTime}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "var(--tg-hint)" }}>Длительность</span>
            <span className="font-medium">{hours} ч.</span>
          </div>
          {total !== null && (
            <>
              <div style={{ borderTop: "0.5px solid rgba(0,0,0,0.06)" }} className="pt-3">
                <div className="flex justify-between">
                  <span className="font-semibold">Итого</span>
                  <span className="text-[19px] font-bold">
                    {total.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-xl text-center text-[14px] font-medium" style={{ background: "#fef2f2", color: "#dc2626" }}>
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="tg-button"
        >
          {loading ? "Бронируем..." : "Забронировать"}
        </button>

        <button
          onClick={() => {
            haptic.impact("light");
            onCancel();
          }}
          className="tg-button"
          style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
        >
          Назад
        </button>
      </div>
    </div>
  );
}
