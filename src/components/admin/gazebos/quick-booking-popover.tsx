"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { calcBookingPrice, type ResourcePricing } from "@/modules/gazebos/pricing";

type GazeboQuickBookingPopoverProps = {
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string;
  maxEndTime: string;
  pricePerHour: number | null;
  /**
   * Прайсинг ресурса на выбранную дату (учитывает будни/выходные и дневной
   * тариф). Если задан — цена считается по нему; иначе fallback на будний
   * pricePerHour. Источник — Resource.metadata.priceList.
   */
  pricing?: ResourcePricing | null;
  /** Из настроек модуля (Module.config.minBookingHours), не хардкод (#523). */
  minBookingHours: number;
  onClose: () => void;
  onCreated: () => void;
};

const CLOSE_TIME = "23:00";

type GuestMatch = { name: string; phone: string };

function durationLabel(startHHMM: string, endHHMM: string): string {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  const durationMin = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMin <= 0) return "—";
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return h > 0 ? (m > 0 ? `${h}ч ${m}мин` : `${h}ч`) : `${m}мин`;
}

function durationHours(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const totalMinutes = h * 60 + m + hours * 60;
  const nh = Math.floor(totalMinutes / 60);
  const nm = totalMinutes % 60;
  if (nh >= 23) return CLOSE_TIME;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function GazeboQuickBookingPopover({
  resourceId,
  resourceName,
  date,
  startTime,
  maxEndTime,
  pricePerHour,
  pricing,
  minBookingHours,
  onClose,
  onCreated,
}: GazeboQuickBookingPopoverProps) {
  const router = useRouter();

  const defaultEnd = addHours(startTime, minBookingHours) <= maxEndTime
    ? addHours(startTime, minBookingHours)
    : maxEndTime;

  const [startInput, setStartInput] = useState(startTime);
  const [endInput, setEndInput] = useState(defaultEnd);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestMatches, setGuestMatches] = useState<GuestMatch[]>([]);
  const [showMatches, setShowMatches] = useState(false);

  // #666: автокомплит гостя по телефону — не блокирует ручной ввод, если
  // совпадений нет (AC-3).
  useEffect(() => {
    const query = clientPhone.trim();
    if (query.length < 3) {
      setGuestMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/gazebos/guests/search?phone=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setGuestMatches(data.data);
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [clientPhone]);

  function selectGuest(guest: GuestMatch) {
    setClientPhone(guest.phone);
    setClientName(guest.name);
    setGuestMatches([]);
    setShowMatches(false);
  }

  const hours = durationHours(startInput, endInput);
  // Цена по прайсингу даты (выходные дороже + дневной тариф-кэп); fallback —
  // будний pricePerHour, если priceList для ресурса не задан.
  const totalPrice =
    hours > 0
      ? pricing
        ? Math.round(calcBookingPrice(pricing, hours).total)
        : pricePerHour
          ? Math.round(hours * pricePerHour)
          : null
      : null;
  const duration = durationLabel(startInput, endInput);
  const minEnd = addHours(startInput, minBookingHours);
  const isValid = startInput < endInput && endInput <= maxEndTime && durationHours(startInput, endInput) >= minBookingHours;

  useEffect(() => {
    if (endInput <= startInput || durationHours(startInput, endInput) < minBookingHours) {
      const minEndTime = addHours(startInput, minBookingHours);
      setEndInput(minEndTime <= maxEndTime ? minEndTime : maxEndTime);
    }
  }, [startInput, endInput, maxEndTime, minBookingHours]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/gazebos/admin-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          date,
          startTime: startInput,
          endTime: endInput,
          clientName,
          clientPhone,
          ...(guestCount && { guestCount: parseInt(guestCount, 10) }),
          ...(comment.trim() && { comment: comment.trim() }),
          ...(email.trim() && { email: email.trim() }),
        }),
      });

      const data = await res.json();
      if (data.success) {
        onCreated();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка при создании");
      }
    } catch {
      setError("Не удалось создать бронирование");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 mx-4">

        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">{resourceName}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">{date}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Начало</label>
            <input
              type="time"
              value={startInput}
              min="08:00"
              onChange={(e) => setStartInput(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Конец
              <span className="ml-1 text-zinc-400 font-normal text-[10px]">до {maxEndTime}</span>
            </label>
            <input
              type="time"
              value={endInput}
              min={minEnd}
              max={maxEndTime}
              onChange={(e) => setEndInput(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-1 ${
                isValid
                  ? "border-zinc-300 focus:border-blue-500 focus:ring-blue-500"
                  : "border-red-300 focus:border-red-500 focus:ring-red-500"
              }`}
            />
          </div>
        </div>

        {hours > 0 && (
          <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2 mb-3 flex items-center justify-between text-sm">
            <span className="text-zinc-600">{duration}</span>
            {totalPrice !== null && (
              <span className="font-semibold text-zinc-800 tabular-nums">
                {totalPrice.toLocaleString("ru-RU")} ₽
              </span>
            )}
          </div>
        )}

        {startInput >= endInput ? (
          <p className="text-xs text-red-500 mb-2">Начало должно быть раньше конца</p>
        ) : !isValid && durationHours(startInput, endInput) < minBookingHours ? (
          <p className="text-xs text-amber-600 mb-2">Минимум {minBookingHours} ч.</p>
        ) : null}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            required
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Имя клиента *"
            autoFocus
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="relative">
            <input
              type="tel"
              required
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              onFocus={() => setShowMatches(true)}
              onBlur={() => setTimeout(() => setShowMatches(false), 150)}
              placeholder="Телефон *"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {showMatches && guestMatches.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-lg max-h-40 overflow-y-auto">
                {guestMatches.map((guest) => (
                  <li key={guest.phone}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectGuest(guest);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <span className="font-medium text-zinc-900">{guest.name}</span>
                      <span className="ml-2 text-zinc-400">{guest.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            type="number"
            value={guestCount}
            onChange={(e) => setGuestCount(e.target.value)}
            placeholder="Кол-во гостей"
            min="1"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (необязательно)"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий (необязательно)"
            maxLength={500}
            rows={2}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={submitting || !clientName.trim() || !clientPhone.trim() || !isValid}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "Создание..." : "Забронировать"}
          </button>
        </form>
      </div>
    </div>
  );
}
