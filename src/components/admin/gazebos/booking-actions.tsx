"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";

type Props = {
  bookingId: string;
  currentStatus: BookingStatus;
};

export function BookingActions({ bookingId, currentStatus }: Props) {
  const router = useRouter();

  async function updateStatus(status: BookingStatus) {
    const res = await fetch(`/api/gazebos/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
    return null;
  }

  return (
    <div className="flex gap-2">
      {currentStatus === "PENDING" && (
        <Button size="sm" onClick={() => updateStatus("CONFIRMED")}>
          Подтвердить
        </Button>
      )}
      {currentStatus === "CONFIRMED" && (
        <Button size="sm" variant="secondary" onClick={() => updateStatus("COMPLETED")}>
          Завершить
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={() => updateStatus("CANCELLED")}>
        Отменить
      </Button>
    </div>
  );
}
