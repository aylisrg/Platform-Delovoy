"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ContractStatus } from "@prisma/client";

type Props = {
  contractId: string;
  currentStatus: ContractStatus;
};

export function ContractActions({ contractId, currentStatus }: Props) {
  const router = useRouter();

  async function updateStatus(status: ContractStatus) {
    const res = await fetch(`/api/rental/contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  if (currentStatus === "EXPIRED" || currentStatus === "TERMINATED") {
    return null;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {currentStatus === "DRAFT" && (
        <Button size="sm" onClick={() => updateStatus("ACTIVE")}>
          Активировать
        </Button>
      )}
      {(currentStatus === "ACTIVE" || currentStatus === "EXPIRING") && (
        <Button size="sm" variant="danger" onClick={() => updateStatus("TERMINATED")}>
          Расторгнуть
        </Button>
      )}
    </div>
  );
}
