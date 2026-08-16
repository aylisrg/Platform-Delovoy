"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  DURATION_CHIPS_MIN,
  billedHours,
  durationLabel,
  endTimeFromDuration,
  maxDurationMin,
  parseHHMM,
  selectedChip,
} from "@/lib/booking-time";

type GuestMatch = { name: string; phone: string };

export type MobileBookingSheetProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string; // "HH:MM"
  maxEndTime: string; // "HH:MM"
  pricePerHour: number | null;
};

export function MobileBookingSheet({
  open,
  onClose,
  onCreated,
  resourceId,
  resourceName,
  date,
  startTime,
  maxEndTime,
  pricePerHour,
}: MobileBookingSheetProps) {
  const router = useRouter();

  const availableChips = useMemo(() => {
    const cap = maxDurationMin(startTime, maxEndTime);
    return DURATION_CHIPS_MIN.filter((d) => d <= cap);
  }, [startTime, maxEndTime]);

  const defaultChip = availableChips.includes(60)
    ? 60
    : availableChips[0] ?? 30;

  const [durationMin, setDurationMin] = useState<number>(defaultChip);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestMatches, setGuestMatches] = useState<GuestMatch[]>([]);
  const [showMatches, setShowMatches] = useState(false);

  // Reset state when sheet re-opens for a different slot
  useEffect(() => {
    if (!open) return;
    setDurationMin(defaultChip);
    setClientName("");
    setClientPhone("");
    setComment("");
    setEmail("");
    setGuestMatches([]);
    setShowMatches(false);
    setError(null);
    setSubmitting(false);
  }, [open, defaultChip]);

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
      fetch(`/api/ps-park/guests/search?phone=${encodeURIComponent(query)}`, { signal: controller.signal })
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

  const endTime = endTimeFromDuration(startTime, durationMin, maxEndTime);
  const actualChip = selectedChip(startTime, endTime);
  const actualDuration = parseHHMM(endTime) - parseHHMM(startTime);
  const billed = billedHours(startTime, endTime);
  const totalPrice = pricePerHour && billed > 0 ? billed * pricePerHour : null;

  const isValid =
    actualDuration > 0 &&
    parseHHMM(endTime) <= parseHHMM(maxEndTime) &&
    clientName.trim().length > 0;

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ps-park/admin-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          date,
          startTime,
          endTime,
          clientName: clientName.trim(),
          ...(clientPhone.trim() && { clientPhone: clientPhone.trim() }),
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
    <BottomSheet
      open={open}
      onClose={onClose}
      title={resourceName}
      subtitle={`${date} · начало ${startTime}`}
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValid || submitting}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting
            ? "Создание..."
            : totalPrice !== null
              ? `Забронировать · ${totalPrice.toLocaleString("ru-RU")} ₽`
              : "Забронировать"}
        </button>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Длительность
          </label>
          <div className="flex flex-wrap gap-2">
            {availableChips.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDurationMin(d)}
                className={`h-11 min-w-[76px] rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  actualChip === d
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                }`}
              >
                {d < 60 ? `${d}м` : d % 60 === 0 ? `${d / 60}ч` : `${Math.floor(d / 60)}ч ${d % 60}м`}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3 text-sm">
          <div className="flex items-center justify-between text-zinc-700">
            <span>Конец</span>
            <span className="font-semibold tabular-nums">{endTime}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-zinc-500 text-xs">
            <span>{durationLabel(startTime, endTime)}</span>
            {pricePerHour !== null && billed > 0 && (
              <span>
                {billed}ч × {pricePerHour.toLocaleString("ru-RU")} ₽ ={" "}
                <span className="font-semibold text-zinc-700">
                  {(billed * pricePerHour).toLocaleString("ru-RU")} ₽
                </span>
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            Имя клиента <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Например, Иван"
            autoComplete="name"
            className="h-12 w-full rounded-lg border border-zinc-300 px-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="relative">
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            Телефон <span className="text-zinc-400 font-normal">(необязательно)</span>
          </label>
          <input
            type="tel"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            onFocus={() => setShowMatches(true)}
            onBlur={() => setTimeout(() => setShowMatches(false), 150)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 ___ ___ __ __"
            className="h-12 w-full rounded-lg border border-zinc-300 px-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-zinc-50"
                  >
                    <span className="font-medium text-zinc-900">{guest.name}</span>
                    <span className="ml-2 text-zinc-400">{guest.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            Email <span className="text-zinc-400 font-normal">(необязательно)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="email"
            placeholder="guest@example.com"
            className="h-12 w-full rounded-lg border border-zinc-300 px-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            Комментарий <span className="text-zinc-400 font-normal">(необязательно)</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Пожелания гостя, особые условия…"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
