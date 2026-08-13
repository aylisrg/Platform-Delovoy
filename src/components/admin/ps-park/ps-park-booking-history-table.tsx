"use client";

import { useState, useEffect } from "react";
import type { BookingStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { BookingPaymentBadge } from "@/components/admin/payments/booking-payment-badge";
import { PaymentBadge } from "@/components/admin/shared/payment-badge";
import { BookingHistory } from "@/components/admin/shared/booking-history";
import type { BookingPaymentStatus } from "@/modules/payments/types";
import {
  DeleteConfirmDialog,
  deleteWithPassword,
} from "@/components/admin/shared/delete-confirm-dialog";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified } from "@/lib/format";

const statusLabel: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Идёт сеанс",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
  NO_SHOW: "Не явился",
};

const statusVariant: Record<string, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CHECKED_IN: "success",
  COMPLETED: "info",
  CANCELLED: "default",
  NO_SHOW: "default",
};

type Booking = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  clientPhone: string | null;
  resourceName: string | null;
  metadata: Record<string, unknown> | null;
  cashAmount: string | null;
  cardAmount: string | null;
  paymentStatus: BookingPaymentStatus;
};

export function PSParkBookingHistoryTable() {
  const router = useRouter();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPERADMIN";

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Поиск по имени/телефону гостя (#438) — «гость звонит: я бронировал».
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Какая строка раскрыта лентой событий.
  const [historyId, setHistoryId] = useState<string | null>(null);
  const perPage = 20;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadBookings();
  }, [page, statusFilter, dateFrom, dateTo, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBookings() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/ps-park/bookings?${params}`);
      const json = await res.json();
      if (json.success) {
        setBookings(json.data.map((b: Record<string, unknown>) => ({
          id: b.id,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          clientName: b.clientName ?? (b.user as Record<string, unknown>)?.name ?? null,
          clientPhone: b.clientPhone ?? (b.user as Record<string, unknown>)?.phone ?? null,
          resourceName: (b.resource as Record<string, unknown>)?.name ?? null,
          metadata: (b.metadata as Record<string, unknown> | null) ?? null,
          cashAmount: (b.cashAmount as string | null) ?? null,
          cardAmount: (b.cardAmount as string | null) ?? null,
          paymentStatus: (b.paymentStatus as BookingPaymentStatus) ?? "NONE",
        })));
        setTotal(json.meta?.total ?? 0);
      }
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(password: string, reason: string | null) {
    if (!deletingId) return "Нет выбранной записи";
    const err = await deleteWithPassword(
      `/api/ps-park/bookings/${deletingId}`,
      password,
      reason
    );
    if (err) return err;
    // Reconcile with server: refresh RSC tree + reload local table so the
    // booking is gone from list/timeline/analytics on this page too.
    setShowDeleteConfirm(false);
    setDeletingId(null);
    router.refresh();
    await loadBookings();
    return null;
  }

  const totalPages = Math.ceil(total / perPage);

  function formatTime(dt: string) {
    return formatTimeUnified(dt);
  }

  function formatDate(dt: string) {
    return formatDateUnified(dt);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Поиск: имя, телефон"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="PENDING">Ожидает</option>
          <option value="CONFIRMED">Подтверждено</option>
          <option value="COMPLETED">Завершено</option>
          <option value="CANCELLED">Отменено</option>
          <option value="NO_SHOW">Не явился</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm" />
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-400 animate-pulse">Загрузка...</div>
      ) : bookings.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-400">Нет бронирований</div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-zinc-500">
                <th className="pb-3 font-medium">Дата</th>
                <th className="pb-3 font-medium">Время</th>
                <th className="pb-3 font-medium">Стол</th>
                <th className="pb-3 font-medium">Клиент</th>
                <th className="pb-3 font-medium">Телефон</th>
                <th className="pb-3 font-medium">Статус</th>
                <th className="pb-3 font-medium">Оплата</th>
                <th className="pb-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => [
                <tr key={b.id} className="border-b border-zinc-50">
                  <td className="py-3 text-zinc-900">{formatDate(b.date)}</td>
                  <td className="py-3 text-zinc-600">{formatTime(b.startTime)} — {formatTime(b.endTime)}</td>
                  <td className="py-3 text-zinc-600">{b.resourceName ?? "—"}</td>
                  <td className="py-3 text-zinc-600">{b.clientName ?? "—"}</td>
                  <td className="py-3 text-zinc-600">{b.clientPhone ?? "—"}</td>
                  <td className="py-3">
                    <Badge variant={statusVariant[b.status] ?? "default"}>
                      {statusLabel[b.status] ?? b.status}
                    </Badge>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {/* Деньги целиком: касса + карта + онлайн. */}
                      <PaymentBadge booking={{ ...b, status: b.status as BookingStatus }} />
                      {/* Онлайн-бейдж оставлен только там, где он знает то,
                          чего не знает сумма: возврат и ожидание оплаты. */}
                      {(b.paymentStatus === "REFUNDED" ||
                        b.paymentStatus === "PARTIALLY_REFUNDED" ||
                        b.paymentStatus === "AWAITING") && (
                        <BookingPaymentBadge status={b.paymentStatus} />
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setHistoryId(historyId === b.id ? null : b.id)}
                      className="mr-2 text-zinc-500 hover:text-zinc-800 transition-colors"
                      title="История брони"
                    >
                      🕓
                    </button>
                    {isSuperAdmin && (
                      <button
                        onClick={() => { setDeletingId(b.id); setShowDeleteConfirm(true); }}
                        className="text-red-500 hover:text-red-700 transition-colors"
                        title="Удалить бронь"
                      >
                        🗑️
                      </button>
                    )}
                  </td>
                </tr>,
                historyId === b.id ? (
                  <tr key={`${b.id}-history`} className="bg-zinc-50/60">
                    <td colSpan={8} className="p-0">
                      <BookingHistory
                        bookingId={b.id}
                        moduleSlug="ps-park"
                        bookingLabel={`${b.resourceName ?? "—"} · ${formatDate(b.date)} · ${b.clientName ?? "без имени"}`}
                        onRestored={loadBookings}
                      />
                    </td>
                  </tr>
                ) : null,
              ]).flat()}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-zinc-500">Страница {page} из {totalPages} ({total} записей)</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="rounded-lg px-3 py-1.5 text-sm border border-zinc-300 disabled:opacity-50 hover:bg-zinc-50">&larr;</button>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="rounded-lg px-3 py-1.5 text-sm border border-zinc-300 disabled:opacity-50 hover:bg-zinc-50">&rarr;</button>
              </div>
            </div>
          )}
        </>
      )}

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        title="Удалить бронь?"
        target={deletingId ? `бронь ${deletingId.slice(0, 8)}` : undefined}
        description="Запись не исчезнет из системы — бронь помечается как удалённая, а в журнале удалений остаётся полный снапшот, кто и когда её удалил."
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeletingId(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
