"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { SlotPicker } from "@/components/webapp/SlotPicker";
import { BookingConfirm } from "@/components/webapp/BookingConfirm";
import { SuccessScreen } from "@/components/webapp/SuccessScreen";

interface PSResource {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  pricePerHour: string | null;
  metadata: Record<string, unknown> | null;
}

interface TimeSlot {
  time: string;
  available: boolean;
}

type Step = "select" | "confirm" | "success";

export default function PSParkBookingPage() {
  const params = useParams();
  const router = useRouter();
  const { ready, apiFetch, showBackButton, onBackButtonClick } = useTelegram();

  const [resource, setResource] = useState<PSResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("select");

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStart, setSelectedStart] = useState("");
  const [selectedEnd, setSelectedEnd] = useState("");

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => {
      if (step === "confirm") setStep("select");
      else if (step === "success") router.push("/webapp/bookings");
      else router.back();
    });
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick, step, router]);

  useEffect(() => {
    if (!ready) return;
    fetch(`/api/ps-park/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setResource(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ready, params.id]);

  const fetchSlots = useCallback(
    async (date: string): Promise<TimeSlot[]> => {
      const res = await fetch(
        `/api/ps-park/availability?date=${date}&resourceId=${params.id}`
      );
      const data = await res.json();
      if (!data.success) return [];
      return data.data.slots || data.data || [];
    },
    [params.id]
  );

  const handleSlotSelect = useCallback(
    (date: string, startTime: string, endTime: string) => {
      setSelectedDate(date);
      setSelectedStart(startTime);
      setSelectedEnd(endTime);
    },
    []
  );

  const handleConfirm = async () => {
    await apiFetch("/api/webapp/book", {
      method: "POST",
      body: JSON.stringify({
        moduleSlug: "ps-park",
        resourceId: params.id,
        date: selectedDate,
        startTime: selectedStart,
        endTime: selectedEnd,
      }),
    });
    setStep("success");
  };

  if (loading) {
    return (
      <div className="px-4 pt-4 space-y-4">
        <div className="tg-skeleton h-8 w-48 rounded-lg" />
        <div className="tg-skeleton h-4 w-64 rounded-lg" />
        <div className="tg-skeleton h-48 rounded-2xl mt-4" />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <span className="text-4xl">😕</span>
        <p className="mt-3 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Стол не найден
        </p>
      </div>
    );
  }

  const pricePerHour = resource.pricePerHour ? Number(resource.pricePerHour) : null;

  if (step === "success") {
    return (
      <SuccessScreen
        title="Забронировано!"
        subtitle={resource.name}
        details={[
          { label: "Дата", value: selectedDate },
          { label: "Время", value: `${selectedStart} — ${selectedEnd}` },
        ]}
        actionLabel="Мои бронирования"
        onAction={() => router.push("/webapp/bookings")}
      />
    );
  }

  if (step === "confirm") {
    return (
      <BookingConfirm
        resourceName={resource.name}
        date={selectedDate}
        startTime={selectedStart}
        endTime={selectedEnd}
        pricePerHour={pricePerHour}
        onConfirm={handleConfirm}
        onCancel={() => setStep("select")}
      />
    );
  }

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[22px] font-bold">{resource.name}</h1>
        <div className="flex items-center gap-3 mt-1 text-[14px]" style={{ color: "var(--tg-hint)" }}>
          {resource.capacity && <span>до {resource.capacity} чел.</span>}
          {pricePerHour && <span>{pricePerHour.toLocaleString("ru-RU")} ₽/час</span>}
        </div>
        {resource.description && (
          <p className="mt-2 text-[14px]" style={{ color: "var(--tg-hint)" }}>
            {resource.description}
          </p>
        )}
      </div>

      <div className="mt-2">
        <SlotPicker
          fetchSlots={fetchSlots}
          onSelect={handleSlotSelect}
          minHours={1}
        />
      </div>

      {selectedStart && selectedEnd && (
        <div className="px-4 mt-6 pb-4 tg-page-enter">
          <button onClick={() => setStep("confirm")} className="tg-button">
            Далее — {selectedStart} – {selectedEnd}
          </button>
        </div>
      )}
    </div>
  );
}
