"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@prisma/client";
import { ConfirmDialog } from "@/components/admin/shared/confirm-dialog";

type Props = {
  bookingId: string;
  currentStatus: BookingStatus;
  /** Факты для диалога подтверждения — чтобы менеджер видел, ту ли бронь закрывает. */
  clientName?: string;
  resourceName?: string;
  /** Готовая строка вида «28.08.2026, 13:00–17:00». */
  timeLabel?: string;
};

type ApiErrorBody = { success: false; error?: { code?: string; message?: string } };
type ApiOkBody = { success: true; data: unknown };

export function BookingActions({
  bookingId,
  currentStatus,
  clientName,
  resourceName,
  timeLabel,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"cancel" | "complete" | null>(null);

  /** Возвращает текст ошибки или null при успехе. */
  async function updateStatus(
    status: BookingStatus,
    opts?: { reason?: string }
  ): Promise<string | null> {
    setError(null);
    try {
      const res = await fetch(`/api/ps-park/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(opts?.reason && { reason: opts.reason }) }),
      });
      const body = (await res.json().catch(() => null)) as ApiOkBody | ApiErrorBody | null;
      if (!res.ok || !body || body.success === false) {
        return (
          (body && "error" in body && body.error?.message) ||
          `Не удалось обновить статус (HTTP ${res.status})`
        );
      }
      startTransition(() => router.refresh());
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Сетевая ошибка";
    }
  }

  async function handleInlineStatus(status: BookingStatus) {
    const message = await updateStatus(status);
    if (message) setError(message);
  }

  async function handleDialogConfirm(status: BookingStatus, reason: string | null) {
    const message = await updateStatus(status, reason ? { reason } : undefined);
    if (message) return message;
    setDialog(null);
    return null;
  }

  if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
    return null;
  }

  const canComplete = currentStatus === "CONFIRMED" || currentStatus === "CHECKED_IN";

  const details = [
    ...(clientName ? [{ label: "Гость", value: clientName }] : []),
    ...(resourceName ? [{ label: "Стол", value: resourceName }] : []),
    ...(timeLabel ? [{ label: "Время", value: timeLabel }] : []),
  ];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {currentStatus === "PENDING" && (
          <Button size="sm" disabled={pending} onClick={() => handleInlineStatus("CONFIRMED")}>
            Подтвердить
          </Button>
        )}
        {canComplete && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => { setError(null); setDialog("complete"); }}
          >
            Завершить
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => { setError(null); setDialog("cancel"); }}
        >
          Отменить
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={dialog === "complete"}
        title="Завершить бронь?"
        description="Бронь уйдёт из расписания и слот освободится."
        details={details}
        warning="Закрытую бронь нельзя переоткрыть одним кликом — вернуть её сможет только суперадмин через историю брони."
        confirmLabel="Да, завершить"
        variant="neutral"
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => handleDialogConfirm("COMPLETED", reason)}
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        title="Отменить бронь?"
        description="Бронь исчезнет из расписания, слот освободится и его сможет занять другой гость."
        details={details}
        warning="Отмена не восстанавливается автоматически — вернуть бронь сможет только суперадмин."
        confirmLabel="Да, отменить бронь"
        variant="danger"
        reason={{
          label: "Причина отмены",
          placeholder: "Гость отказался, дубль, техническая накладка…",
        }}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => handleDialogConfirm("CANCELLED", reason)}
      />
    </div>
  );
}
