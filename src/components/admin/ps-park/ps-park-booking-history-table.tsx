"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
                {isSuperAdmin && <th className="pb-3 font-medium text-right">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
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
                  {isSuperAdmin && (
                    <td className="py-3 text-right">
                      <button
                        onClick={() => { setDeletingId(b.id); setShowDeleteConfirm(true); }}
                        className="text-red-500 hover:text-red-700 transition-colors"
                        title="Удалить бронь"
                      >
                        🗑️
                      </button>
                    </td>
                  )}
                </tr>
              ))}
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
