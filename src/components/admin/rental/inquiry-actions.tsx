"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { InquiryStatus } from "@prisma/client";

type Props = {
  inquiryId: string;
  currentStatus: InquiryStatus;
  isRead: boolean;
};

export function InquiryActions({ inquiryId, currentStatus, isRead }: Props) {
  const router = useRouter();

  async function update(data: Record<string, unknown>) {
    const res = await fetch(`/api/rental/inquiries/${inquiryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) router.refresh();
  }

  if (currentStatus === "CONVERTED" || currentStatus === "CLOSED") {
    return null;
  }

  return (
    <div className="flex gap-1.5 flex-wrap">
      {!isRead && (
        <Button size="sm" onClick={() => update({ isRead: true })}>
          Прочитано
        </Button>
      )}
      {currentStatus === "NEW" && (
        <Button size="sm" onClick={() => update({ status: "IN_PROGRESS", isRead: true })}>
          В работу
        </Button>
      )}
      {currentStatus === "IN_PROGRESS" && (
        <Button size="sm" onClick={() => update({ status: "CONVERTED" })}>
          Клиент
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={() => update({ status: "CLOSED" })}>
        Закрыть
      </Button>
    </div>
  );
}
