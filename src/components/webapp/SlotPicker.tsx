"use client";

import { useState, useEffect, useMemo } from "react";
import { useTelegram } from "./TelegramProvider";

interface TimeSlot {
  time: string; // "10:00"
  available: boolean;
}

interface SlotPickerProps {
  /** Fetch availability for a given date: returns array of time slots */
  fetchSlots: (date: string) => Promise<TimeSlot[]>;
  /** When selection changes */
  onSelect: (date: string, startTime: string, endTime: string) => void;
  /** Minimum booking duration in hours */
  minHours?: number;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getDayLabel(d: Date, today: Date): string {
  const diff = Math.floor(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";

  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const months = [
    "янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
  ];
  return `${weekdays[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

export function SlotPicker({ fetchSlots, onSelect, minHours = 1 }: SlotPickerProps) {
  const { haptic } = useTelegram();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Generate next 14 days
  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [today]);

  const [selectedDate, setSelectedDate] = useState(formatDate(days[0]));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [startSlot, setStartSlot] = useState<string | null>(null);
  const [endSlot, setEndSlot] = useState<string | null>(null);

  // Fetch slots when date changes — also resets the in-flight selection so
  // a user moving to a new day starts fresh. Both the loading flag and the
  // selection reset are part of the same "new date, new state" transition.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on date change
    setLoading(true);
    setStartSlot(null);
    setEndSlot(null);
    fetchSlots(selectedDate)
      .then(setSlots)
      .catch(() => setSlots([]))
      .finally(() => setLoading(false));
  }, [selectedDate, fetchSlots]);

  // Default end time = startSlot + minHours, but only when the user hasn't
  // explicitly picked an end time (handleEndSlotTap also writes setEndSlot).
  useEffect(() => {
    if (!startSlot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing dependent state when start cleared
      setEndSlot(null);
      return;
    }
    const [h, m] = startSlot.split(":").map(Number);
    const endH = h + minHours;
    const end = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    setEndSlot(end);
    onSelect(selectedDate, startSlot, end);
  }, [startSlot, selectedDate, minHours, onSelect]);

  const handleSlotTap = (time: string) => {
    haptic.selection();
    if (startSlot === time) {
      setStartSlot(null);
    } else {
      setStartSlot(time);
    }
  };

  const handleEndSlotTap = (time: string) => {
    haptic.selection();
    setEndSlot(time);
    if (startSlot) {
      onSelect(selectedDate, startSlot, time);
    }
  };

  // Available end times (after start)
  const endSlots = useMemo(() => {
    if (!startSlot) return [];
    const [startH] = startSlot.split(":").map(Number);
    return slots.filter((s) => {
      const [h] = s.time.split(":").map(Number);
      return h > startH;
    });
  }, [startSlot, slots]);

  return (
    <div className="tg-page-enter">
      {/* Date picker — horizontal scroll */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {days.map((d) => {
          const dateStr = formatDate(d);
          const isActive = dateStr === selectedDate;

          return (
            <button
              key={dateStr}
              onClick={() => {
                haptic.selection();
                setSelectedDate(dateStr);
              }}
              className="flex flex-col items-center flex-shrink-0 rounded-xl px-3 py-2 transition-all"
              style={{
                background: isActive ? "var(--tg-button)" : "var(--tg-secondary-bg)",
                color: isActive ? "var(--tg-button-text)" : "var(--tg-text)",
                minWidth: 64,
              }}
            >
              <span className="text-[11px] font-medium opacity-80">
                {getDayLabel(d, today).split(",")[0]}
              </span>
              <span className="text-[20px] font-bold leading-tight">
                {d.getDate()}
              </span>
              <span className="text-[11px] opacity-70">
                {["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"][d.getMonth()]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Start time slots */}
      <div className="px-4 mt-2">
        <p className="tg-section-header">Время начала</p>
        {loading ? (
          <div className="grid grid-cols-4 gap-2 mt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="tg-skeleton h-10 rounded-xl" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <p className="text-center py-6 text-[15px]" style={{ color: "var(--tg-hint)" }}>
            Нет доступных слотов на эту дату
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 mt-2">
            {slots.map((slot) => (
              <button
                key={slot.time}
                onClick={() => slot.available && handleSlotTap(slot.time)}
                className={`tg-slot ${startSlot === slot.time ? "selected" : ""} ${!slot.available ? "unavailable" : ""}`}
              >
                {slot.time}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* End time (if start selected) */}
      {startSlot && endSlots.length > 0 && (
        <div className="px-4 mt-4 tg-page-enter">
          <p className="tg-section-header">Время окончания</p>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {endSlots.map((slot) => (
              <button
                key={slot.time}
                onClick={() => handleEndSlotTap(slot.time)}
                className={`tg-slot ${endSlot === slot.time ? "selected" : ""}`}
              >
                {slot.time}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
