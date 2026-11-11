"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { trackDashboard } from "./tracking";

export function PSBooking({
  id,
  date,
  start,
  end,
  resource,
  status,
  total,
  paid,
  canCancel,
  paymentUrl,
}: {
  id: string;
  date: string;
  start: string;
  end: string;
  resource: string;
  status: string;
  total: number;
  paid: number;
  canCancel: boolean;
  paymentUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [penalty, setPenalty] = useState<number | null>(null);
  const [error, setError] = useState("");
  const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">{resource}</h2>
        <p className="mt-2 text-sm text-zinc-600">
          {formatDate(date)} · {start}–{end} МСК
        </p>
        <p className="mt-2 text-sm">{status}</p>
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Стоимость</dt>
          <dd>{total > 0 ? rub(total) : "Уточняется"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Оплачено</dt>
          <dd>{rub(paid)}</dd>
        </div>
      </dl>
      {paymentUrl && (
        <a
          href={paymentUrl}
          className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-4 text-sm font-medium text-white"
        >
          Продолжить оплату
        </a>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {penalty !== null && (
        <p role="alert" className="text-sm text-zinc-700">
          При отмене действует штраф {rub(penalty)}. Подтвердите, если согласны.
        </p>
      )}
      {canCancel && (
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy}
            className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 text-sm text-red-800 disabled:opacity-50"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              trackDashboard("booking_action_started", { action: "cancel" });
              try {
                const response = await fetch(`/api/profile/bookings/${id}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "cancel",
                    confirmRefund: penalty !== null,
                  }),
                });
                const result = await response.json();
                if (!response.ok || !result.success)
                  throw new Error(
                    result.error?.message ?? "Не удалось отменить бронь",
                  );
                if (result.data.confirmationRequired)
                  setPenalty(result.data.penaltyAmount);
                else {
                  setPenalty(null);
                  router.refresh();
                }
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Нет связи с сервером",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Отменяем…"
              : penalty !== null
                ? "Подтвердить отмену"
                : "Отменить бронирование"}
          </button>
          {penalty !== null && (
            <button
              disabled={busy}
              onClick={() => setPenalty(null)}
              className="min-h-11 px-3 text-sm"
            >
              Оставить бронь
            </button>
          )}
        </div>
      )}
    </section>
  );
}
