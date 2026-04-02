"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@prisma/client";

type Props = {
  orderId: string;
  currentStatus: OrderStatus;
};

export function OrderActions({ orderId, currentStatus }: Props) {
  const router = useRouter();

  async function updateStatus(status: OrderStatus) {
    const res = await fetch(`/api/cafe/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  if (currentStatus === "CANCELLED" || currentStatus === "DELIVERED") {
    return null;
  }

  return (
    <div className="flex gap-2">
      {currentStatus === "NEW" && (
        <Button size="sm" onClick={() => updateStatus("PREPARING")}>
          Готовить
        </Button>
      )}
      {currentStatus === "PREPARING" && (
        <Button size="sm" onClick={() => updateStatus("READY")}>
          Готово
        </Button>
      )}
      {currentStatus === "READY" && (
        <Button size="sm" variant="secondary" onClick={() => updateStatus("DELIVERED")}>
          Доставлен
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={() => updateStatus("CANCELLED")}>
        Отменить
      </Button>
    </div>
  );
}
