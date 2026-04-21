"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function MarkPaidButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleMark() {
    setError(null);
    try {
      const res = await fetch(`/api/rental/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAt: new Date().toISOString() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" onClick={handleMark} disabled={pending}>
        {pending ? "…" : "Отметить оплаченным"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
