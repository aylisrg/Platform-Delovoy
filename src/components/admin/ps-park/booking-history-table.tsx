"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BookingActions } from "@/components/admin/ps-park/booking-actions";
import { CallButton } from "@/components/admin/telephony/call-button";
import type { BookingBill } from "@/modules/ps-park/types";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified } from "@/lib/format";

const statusLabel: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  CHECKED_IN: "Идёт сеанс",
  NO_SHOW: "Не явился",
};

const statusVariant: Record<string, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
  CHECKED_IN: "success",
  NO_SHOW: "default",
};

function formatTime(dt: string) {
  return formatTimeUnified(dt);
}

function formatDate(dt: string) {
  return formatDateUnified(dt);
}

export type HistoryBooking = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  clientPhone: string | null;
  userName: string | null;
  userEmail: string | null;
  userPhone: string | null;
  resourceId: string;
  hasBill: boolean;
};

type Props = {
  bookings: HistoryBooking[];
  resourceMap: Record<string, string>;
};

export function BookingHistoryTable({ bookings, resourceMap }: Props) {
  const [bill, setBill] = useState<BookingBill | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handleRowClick(b: HistoryBooking) {
    if (b.status !== "COMPLETED") return;
    setLoadingId(b.id);
    try {
      const res = await fetch(`/api/ps-park/bookings/${b.id}/bill`);
      const json = await res.json();
      if (json.success && json.data) {
        setBill(json.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingId(null);
    }
  }

  function getClientDisplay(b: HistoryBooking) {
    const name = b.clientName ?? b.userName ?? b.userEmail ?? "—";
    const phone = b.clientPhone ?? b.userPhone;
    return { name, phone };
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-zinc-500">
            <th className="pb-3 font-medium">Дата</th>
            <th className="pb-3 font-medium">Время</th>
            <th className="pb-3 font-medium">Стол</th>
            <th className="pb-3 font-medium">Клиент</th>
            <th className="pb-3 font-medium">Статус</th>
            <th className="pb-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const { name, phone } = getClientDisplay(b);
            const tableName = resourceMap[b.resourceId] ?? "—";
            const isCompleted = b.status === "COMPLETED";
            const isLoading = loadingId === b.id;
            return (
              <tr
                key={b.id}
                onClick={() => handleRowClick(b)}
                className={`border-b border-zinc-50 transition-colors ${
                  isCompleted
                    ? "cursor-pointer hover:bg-blue-50/50"
                    : ""
                } ${isLoading ? "opacity-60" : ""}`}
              >
                <td className="py-3 text-zinc-900">{formatDate(b.date)}</td>
                <td className="py-3 text-zinc-600 whitespace-nowrap">
                  {formatTime(b.startTime)}–{formatTime(b.endTime)}
                </td>
                <td className="py-3 text-zinc-600">{tableName}</td>
                <td className="py-3 text-zinc-700">
                  <div className="font-medium leading-tight">{name}</div>
                  {phone && (
                    <div className="text-xs text-zinc-400 mt-0.5">{phone}</div>
                  )}
                  {phone && (
                    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                      <CallButton
                        bookingId={b.id}
                        moduleSlug="ps-park"
                        clientPhone={phone}
                      />
                    </div>
                  )}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant[b.status] ?? "default"}>
                      {statusLabel[b.status] ?? b.status}
                    </Badge>
                    {isCompleted && (
                      <span className="text-[10px] text-blue-500">
                        {isLoading ? "..." : "чек"}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3" onClick={(e) => e.stopPropagation()}>
                  <BookingActions bookingId={b.id} currentStatus={b.status as "COMPLETED" | "CANCELLED"} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Bill modal (read-only) */}
      {bill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setBill(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-base font-semibold text-zinc-900">Чек</h2>
              <button
                onClick={() => setBill(null)}
                className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 pb-4">
              <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-900">{bill.resourceName}</span>
                  <span className="text-xs text-zinc-500">{bill.date}</span>
                </div>
                <p className="text-sm text-zinc-600">{bill.clientName}</p>
                <p className="text-xs text-zinc-500">
                  Время: {bill.startTime} — {bill.endTime}
                </p>
              </div>
            </div>

            <div className="px-6 pb-4">
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <div className="bg-zinc-50 px-4 py-2">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Аренда</span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between text-sm">
                    <div>
                      <p className="text-zinc-900">{bill.resourceName}</p>
                      <p className="text-xs text-zinc-500">
                        {bill.billedHours} ч. × {bill.pricePerHour.toLocaleString("ru-RU")} ₽/ч
                      </p>
                    </div>
                    <span className="font-medium text-zinc-900 tabular-nums">
                      {bill.hoursCost.toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                </div>

                {bill.items.length > 0 && (
                  <>
                    <div className="bg-zinc-50 px-4 py-2 border-t border-zinc-200">
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                        Товары ({bill.items.length})
                      </span>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      {bill.items.map((item, idx) => (
                        <div key={item.skuId + idx} className="flex items-start justify-between text-sm">
                          <div>
                            <p className="text-zinc-900">{item.skuName}</p>
                            <p className="text-xs text-zinc-500">
                              {item.quantity} x {item.price.toLocaleString("ru-RU")} ₽
                            </p>
                          </div>
                          <span className="font-medium text-zinc-900 tabular-nums">
                            {item.subtotal.toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="border-t border-zinc-200 px-4 py-3 space-y-1.5 bg-zinc-50/50">
                  <div className="flex justify-between text-sm text-zinc-600">
                    <span>Аренда</span>
                    <span className="tabular-nums">{bill.hoursCost.toLocaleString("ru-RU")} ₽</span>
                  </div>
                  {bill.items.length > 0 && (
                    <div className="flex justify-between text-sm text-zinc-600">
                      <span>Товары</span>
                      <span className="tabular-nums">{bill.itemsTotal.toLocaleString("ru-RU")} ₽</span>
                    </div>
                  )}
                </div>

                <div className="border-t-2 border-zinc-300 px-4 py-3 bg-white">
                  <div className="flex justify-between items-center">
                    <span className="text-base font-bold text-zinc-900">ИТОГО</span>
                    <span className="text-xl font-bold text-zinc-900 tabular-nums">
                      {bill.totalBill.toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-5">
              <button
                type="button"
                onClick={() => setBill(null)}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
