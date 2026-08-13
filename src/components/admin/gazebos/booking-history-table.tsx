"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Toast } from "@/components/ui/toast";
import { BookingPaymentBadge } from "@/components/admin/payments/booking-payment-badge";
import { PaymentBadge } from "@/components/admin/shared/payment-badge";
import { BookingHistory } from "@/components/admin/shared/booking-history";
import type { BookingPaymentStatus } from "@/modules/payments/types";
import {
  DeleteConfirmDialog,
  deleteWithPassword,
} from "@/components/admin/shared/delete-confirm-dialog";
import type { BookingStatus } from "@prisma/client";
import {
  formatDate as formatDateUnified,
  formatTime as formatTimeUnified,
  toISODate,
} from "@/lib/format";

type HistoryBooking = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  clientName: string | null;
  clientPhone: string | null;
  resourceName: string | null;
  metadata: Record<string, unknown> | null;
  cashAmount: string | null;
  cardAmount: string | null;
  paymentStatus: BookingPaymentStatus;
  isGuest: boolean;
};

const statusLabel: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Заехал",
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

export function GazeboBookingHistoryTable() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;

  // Клик по строке → расписание (календарь) на дату брони с подсветкой.
  function openInSchedule(b: HistoryBooking) {
    router.push(`/admin/gazebos?date=${toISODate(b.date)}&booking=${b.id}`);
  }
  const canDelete = role === "SUPERADMIN" || role === "ADMIN";

  const [bookings, setBookings] = useState<HistoryBooking[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Какая строка раскрыта лентой событий. Раскрывается по кнопке, а не по
  // клику в строку — клик уже занят переходом в расписание.
  const [historyId, setHistoryId] = useState<string | null>(null);
  // Опоздавший гость (NO_SHOW → CHECKED_IN, #436): бронь в этом статусе не
  // входит в ACTIVE_BOOKING_STATUSES и не попадает в сетку расписания —
  // единственное место, где её видно и можно заехать, это история.
  const [checkingInId, setCheckingInId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });
  const perPage = 20;

  useEffect(() => {
    loadBookings();
  }, [page, statusFilter, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBookings() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/gazebos/bookings?${params}`);
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
          metadata: b.metadata as Record<string, unknown> | null,
          cashAmount: (b.cashAmount as string | null) ?? null,
          cardAmount: (b.cardAmount as string | null) ?? null,
          paymentStatus: (b.paymentStatus as BookingPaymentStatus) ?? "NONE",
          isGuest: !b.userId,
        })));
        setTotal(json.meta?.total ?? 0);
      }
    } catch {
      // keep old data
    } finally {
      setLoading(false);
    }
  }

  async function handleLateCheckIn(bookingId: string) {
    setCheckingInId(bookingId);
    try {
      const res = await fetch(`/api/gazebos/bookings/${bookingId}/checkin`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setToast({
          message: json?.error?.message ?? `Не удалось отметить заезд (HTTP ${res.status})`,
          type: "error",
          visible: true,
        });
        return;
      }
      setToast({ message: "Гость отмечен как заехавший", type: "success", visible: true });
      await loadBookings();
    } catch {
      setToast({ message: "Сетевая ошибка", type: "error", visible: true });
    } finally {
      setCheckingInId(null);
    }
  }

  async function handleDelete(password: string, reason: string | null) {
    if (!deletingId) return "Нет выбранной записи";
    const err = await deleteWithPassword(
      `/api/gazebos/bookings/${deletingId}`,
      password,
      reason
    );
    if (err) return err;
    setBookings(bookings.filter((b) => b.id !== deletingId));
    setShowDeleteConfirm(false);
    setDeletingId(null);
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
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="PENDING">Ожидает</option>
          <option value="CONFIRMED">Подтверждено</option>
          <option value="CHECKED_IN">Заехал</option>
          <option value="COMPLETED">Завершено</option>
          <option value="CANCELLED">Отменено</option>
          <option value="NO_SHOW">Не явился</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          placeholder="Дата от"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          placeholder="Дата до"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        />
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
                <th className="pb-3 font-medium">Беседка</th>
                <th className="pb-3 font-medium">Клиент</th>
                <th className="pb-3 font-medium">Телефон</th>
                <th className="pb-3 font-medium">Статус</th>
                <th className="pb-3 font-medium">Оплата</th>
                <th className="pb-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => [
                <tr
                  key={b.id}
                  onClick={() => openInSchedule(b)}
                  className="border-b border-zinc-50 cursor-pointer hover:bg-zinc-50 transition-colors"
                  title="Открыть в расписании"
                >
                  <td className="py-3 text-zinc-900">{formatDate(b.date)}</td>
                  <td className="py-3 text-zinc-600">
                    {formatTime(b.startTime)} — {formatTime(b.endTime)}
                  </td>
                  <td className="py-3 text-emerald-700">{b.resourceName ?? "—"}</td>
                  <td className="py-3 text-zinc-600">
                    <span className="inline-flex items-center gap-2">
                      {b.clientName ?? "—"}
                      {b.isGuest && (
                        <Badge variant="warning">Гость</Badge>
                      )}
                    </span>
                  </td>
                  <td className="py-3 text-zinc-600">{b.clientPhone ?? "—"}</td>
                  <td className="py-3">
                    <Badge variant={statusVariant[b.status] ?? "default"}>
                      {statusLabel[b.status] ?? b.status}
                    </Badge>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {/* Деньги целиком: касса + карта + онлайн. */}
                      <PaymentBadge booking={b} />
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
                    {b.status === "NO_SHOW" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleLateCheckIn(b.id); }}
                        disabled={checkingInId === b.id}
                        className="mr-2 text-emerald-600 hover:text-emerald-800 transition-colors disabled:opacity-50"
                        title="Гость опоздал — отметить заезд"
                      >
                        {checkingInId === b.id ? "…" : "Заехал"}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setHistoryId(historyId === b.id ? null : b.id); }}
                      className="mr-2 text-zinc-500 hover:text-zinc-800 transition-colors"
                      title="История брони"
                    >
                      🕓
                    </button>
                    {canDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(b.id); setShowDeleteConfirm(true); }}
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
                        moduleSlug="gazebos"
                        bookingLabel={`${b.resourceName ?? "—"} · ${formatDate(b.date)} · ${b.clientName ?? "без имени"}`}
                        onRestored={loadBookings}
                      />
                    </td>
                  </tr>
                ) : null,
              ]).flat()}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-zinc-500">
                Страница {page} из {totalPages} ({total} записей)
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="rounded-lg px-3 py-1.5 text-sm border border-zinc-300 disabled:opacity-50 hover:bg-zinc-50"
                >
                  &larr;
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg px-3 py-1.5 text-sm border border-zinc-300 disabled:opacity-50 hover:bg-zinc-50"
                >
                  &rarr;
                </button>
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

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </div>
  );
}
