"use client";

import { Badge } from "@/components/ui/badge";
import { BookingActions } from "./booking-actions";
import { BookingPaymentBadge } from "@/components/admin/payments/booking-payment-badge";
import type { BookingPaymentStatus } from "@/modules/payments/types";
import type { BookingStatus } from "@prisma/client";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified, toISODate } from "@/lib/format";

const statusLabel: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
};

const statusVariant: Record<string, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
};

export type GazeboMobileBookingRow = {
  id: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  clientName: string | null;
  clientPhone: string | null;
  // Guest bookings have no linked User row.
  user: { name: string | null; email: string | null; phone: string | null } | null;
  resourceId: string;
  metadata?: unknown;
  paymentStatus?: BookingPaymentStatus;
};

type Props = {
  bookings: GazeboMobileBookingRow[];
  resourceMap: Map<string, string>;
  emphasizePending?: boolean;
};

function formatTime(dt: Date) {
  return formatTimeUnified(dt);
}

function formatDate(dt: Date) {
  return formatDateUnified(dt);
}

function getClient(b: GazeboMobileBookingRow): { name: string; phone: string | null } {
  return {
    name: b.clientName ?? b.user?.name ?? b.user?.email ?? "—",
    phone: b.clientPhone ?? b.user?.phone ?? null,
  };
}

export function GazeboBookingListMobile({ bookings, resourceMap, emphasizePending = false }: Props) {
  if (bookings.length === 0) return null;

  return (
    <ul className="space-y-3">
      {bookings.map((b) => {
        const { name, phone } = getClient(b);
        const gazeboName = resourceMap.get(b.resourceId) ?? "—";
        const borderClass =
          emphasizePending && b.status === "PENDING"
            ? "border-amber-300 bg-amber-50/50"
            : "border-zinc-200 bg-white";
        return (
          <li key={b.id} className={`rounded-xl border ${borderClass} p-3 shadow-sm`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 truncate">{name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {gazeboName} · {formatDate(b.date)} · {formatTime(b.startTime)}–
                  {formatTime(b.endTime)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={statusVariant[b.status] ?? "default"}>
                  {statusLabel[b.status] ?? b.status}
                </Badge>
                <BookingPaymentBadge status={b.paymentStatus} />
              </div>
            </div>

            {phone && (
              <div className="mt-3">
                <a
                  href={`tel:${phone}`}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <span>📞</span>
                  <span className="tabular-nums">{phone}</span>
                </a>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <BookingActions
                bookingId={b.id}
                currentStatus={b.status}
                totalPrice={Number((b.metadata as { totalPrice?: string | number } | undefined)?.totalPrice ?? 0)}
                resourceName={gazeboName}
                clientName={name}
                date={toISODate(b.date)}
                startTime={formatTime(b.startTime)}
                endTime={formatTime(b.endTime)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
