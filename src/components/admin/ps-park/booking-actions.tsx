"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";

type Props = {
  bookingId: string;
  currentStatus: BookingStatus;
};

type ApiErrorBody = { success: false; error?: { code?: string; message?: string } };
type ApiOkBody = { success: true; data: unknown };

export function BookingActions({ bookingId, currentStatus }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function updateStatus(status: BookingStatus, opts?: { reason?: string }) {
    setError(null);
    try {
      const res = await fetch(`/api/ps-park/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(opts?.reason && { reason: opts.reason }) }),
      });
      const body = (await res.json().catch(() => null)) as ApiOkBody | ApiErrorBody | null;
      if (!res.ok || !body || body.success === false) {
        const message =
          (body && "error" in body && body.error?.message) ||
          `Не удалось обновить статус (HTTP ${res.status})`;
        setError(message);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сетевая ошибка");
    }
  }

  function handleCancel() {
    if (typeof window !== "undefined") {
      const ok = window.confirm("Отменить бронирование?");
      if (!ok) return;
      const reason = window.prompt("Причина отмены (необязательно)") ?? undefined;
      void updateStatus("CANCELLED", reason ? { reason } : undefined);
      return;
    }
    void updateStatus("CANCELLED");
  }

  if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
    return null;
  }

  const canComplete = currentStatus === "CONFIRMED" || currentStatus === "CHECKED_IN";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {currentStatus === "PENDING" && (
          <Button size="sm" disabled={pending} onClick={() => updateStatus("CONFIRMED")}>
            Подтвердить
          </Button>
        )}
        {canComplete && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => updateStatus("COMPLETED")}
          >
            Завершить
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={pending} onClick={handleCancel}>
          Отменить
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
