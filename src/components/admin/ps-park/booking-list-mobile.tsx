"use client";

import { Badge } from "@/components/ui/badge";
import { BookingActions } from "./booking-actions";
import { AddItemsButton } from "./add-items-button";
import { CallButton } from "@/components/admin/telephony/call-button";
import type { BookingStatus } from "@prisma/client";

const statusLabel: Record<BookingStatus, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  CHECKED_IN: "Идёт сеанс",
  NO_SHOW: "Не явился",
};

const statusVariant: Record<BookingStatus, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
  CHECKED_IN: "success",
  NO_SHOW: "default",
};

export type MobileBookingRow = {
  id: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  clientName: string | null;
  clientPhone: string | null;
  user: { name: string | null; email: string | null; phone: string | null };
  resourceId: string;
};

type BookingListMobileProps = {
  bookings: MobileBookingRow[];
  resourceMap: Map<string, string>;
  showAddItems?: boolean;
  emphasizePending?: boolean;
};

function formatTime(dt: Date) {
  return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dt: Date) {
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function getClient(b: MobileBookingRow): { name: string; phone: string | null } {
  return {
    name: b.clientName ?? b.user.name ?? b.user.email ?? "—",
    phone: b.clientPhone ?? b.user.phone,
  };
}

export function BookingListMobile({
  bookings,
  resourceMap,
  showAddItems = false,
  emphasizePending = false,
}: BookingListMobileProps) {
  if (bookings.length === 0) return null;

  return (
    <ul className="space-y-3">
      {bookings.map((b) => {
        const { name, phone } = getClient(b);
        const tableName = resourceMap.get(b.resourceId) ?? "—";
        const borderClass =
          emphasizePending && b.status === "PENDING"
            ? "border-amber-300 bg-amber-50/50"
            : "border-zinc-200 bg-white";
        return (
          <li
            key={b.id}
            className={`rounded-xl border ${borderClass} p-3 shadow-sm`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900 truncate">{name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {tableName} · {formatDate(b.date)} · {formatTime(b.startTime)}–
                  {formatTime(b.endTime)}
                </p>
              </div>
              <Badge variant={statusVariant[b.status]}>{statusLabel[b.status]}</Badge>
            </div>

            {phone && (
              <div className="mt-3 flex items-center gap-2">
                <a
                  href={`tel:${phone}`}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <span>📞</span>
                  <span className="tabular-nums">{phone}</span>
                </a>
                <div className="shrink-0">
                  <CallButton
                    bookingId={b.id}
                    moduleSlug="ps-park"
                    clientPhone={phone}
                  />
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <BookingActions bookingId={b.id} currentStatus={b.status} />
              {showAddItems && <AddItemsButton bookingId={b.id} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
