"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { SlotPicker } from "@/components/webapp/SlotPicker";
import { BookingConfirm } from "@/components/webapp/BookingConfirm";
import { SuccessScreen } from "@/components/webapp/SuccessScreen";
import { Badge, Button, EmptyState, Icon, Skeleton } from "@/components/webapp/ui";

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
  const { ready, apiFetch, showBackButton, onBackButtonClick, haptic } =
    useTelegram();

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
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-4 w-64 rounded-lg" />
        <Skeleton className="h-48 rounded-2xl mt-4" />
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <EmptyState
          icon="alert"
          title="Стол не найден"
          hint="Возможно, его сняли с бронирования"
          action={
            <Button onClick={() => router.push("/webapp/ps-park")}>
              Все залы
            </Button>
          }
        />
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
        icon="gamepad"
      />
    );
  }

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[22px] font-bold">{resource.name}</h1>
        {resource.description && (
          <p
            className="mt-1 text-[14px] leading-snug"
            style={{ color: "var(--tg-subtitle)" }}
          >
            {resource.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {pricePerHour && (
            <Badge tone="accent">
              {pricePerHour.toLocaleString("ru-RU")} ₽/час
            </Badge>
          )}
          {resource.capacity ? (
            <span
              className="inline-flex items-center gap-1 text-[13px]"
              style={{ color: "var(--tg-hint)" }}
            >
              <Icon name="users" size={14} />
              до {resource.capacity} чел.
            </span>
          ) : null}
        </div>
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
          <Button
            onClick={() => {
              haptic.impact("light");
              setStep("confirm");
            }}
          >
            Далее — {selectedStart} – {selectedEnd}
          </Button>
        </div>
      )}
    </div>
  );
}
