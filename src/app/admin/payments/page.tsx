"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/admin/header";

type PaymentRefundRow = {
  id: string;
  amount: string;
  status: string;
  reason: string;
  createdAt: string;
};

type PaymentRow = {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  status: string;
  amount: string;
  refundedAmount: string;
  moduleSlug: string;
  subjectType: string;
  subjectId: string;
  description: string;
  paymentMethodType: string | null;
  cancellationReason: string | null;
  confirmationUrl: string | null;
  isTest: boolean;
  paidAt: string | null;
  createdAt: string;
  refunds: PaymentRefundRow[];
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Ожидает оплаты",
  WAITING_FOR_CAPTURE: "Холд",
  SUCCEEDED: "Оплачен",
  CANCELED: "Отменён",
  REFUNDED: "Возвращён",
  PARTIALLY_REFUNDED: "Частичный возврат",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  WAITING_FOR_CAPTURE: "bg-blue-100 text-blue-700",
  SUCCEEDED: "bg-green-100 text-green-700",
  CANCELED: "bg-gray-100 text-gray-600",
  REFUNDED: "bg-purple-100 text-purple-700",
  PARTIALLY_REFUNDED: "bg-purple-100 text-purple-700",
};

const MODULE_LABELS: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
  cafe: "Кафе",
};

const PER_PAGE = 25;

function formatMoney(value: string): string {
  return `${Number(value).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ₽`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
      if (statusFilter) params.set("status", statusFilter);
      if (moduleFilter) params.set("moduleSlug", moduleFilter);
      const res = await fetch(`/api/payments?${params}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "Не удалось загрузить платежи");
        return;
      }
      setPayments(json.data);
      setTotal(json.meta?.total ?? 0);
    } catch {
      setError("Не удалось загрузить платежи");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, moduleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefund(payment: PaymentRow) {
    const reason = window.prompt(
      `Полный возврат ${formatMoney(payment.amount)}?\n\nУкажите причину возврата:`
    );
    if (!reason || reason.trim().length < 3) return;

    setRefundingId(payment.id);
    try {
      const res = await fetch(`/api/payments/${payment.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        window.alert(json.error?.message ?? "Возврат не выполнен");
        return;
      }
      await load();
    } catch {
      window.alert("Возврат не выполнен: ошибка сети");
    } finally {
      setRefundingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Платежи" />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Все статусы</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={moduleFilter}
            onChange={(e) => {
              setPage(1);
              setModuleFilter(e.target.value);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Все модули</option>
            {Object.entries(MODULE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <span className="ml-auto text-sm text-gray-500">Всего: {total}</span>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-3">Создан</th>
                <th className="px-4 py-3">Модуль</th>
                <th className="px-4 py-3">Описание</th>
                <th className="px-4 py-3">Сумма</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Способ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Загрузка…
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Платежей пока нет
                  </td>
                </tr>
              ) : (
                payments.map((p) => {
                  const refundable =
                    p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED";
                  return (
                    <tr key={p.id} className="border-b border-gray-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {formatDateTime(p.createdAt)}
                        {p.isTest && (
                          <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-700">
                            TEST
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {MODULE_LABELS[p.moduleSlug] ?? p.moduleSlug}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3" title={p.description}>
                        {p.description}
                        {p.cancellationReason && (
                          <div className="text-xs text-gray-400">{p.cancellationReason}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        {formatMoney(p.amount)}
                        {Number(p.refundedAmount) > 0 && (
                          <div className="text-xs text-purple-600">
                            возврат {formatMoney(p.refundedAmount)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                        {p.paymentMethodType ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {refundable && (
                          <button
                            onClick={() => handleRefund(p)}
                            disabled={refundingId === p.id}
                            className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {refundingId === p.id ? "Возврат…" : "Вернуть"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              ←
            </button>
            <span className="text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              →
            </button>
          </div>
        )}

        <p className="mt-4 text-xs text-gray-400">
          Возвраты всегда полные. Автовозвраты по политике отмены (более 24 часов до начала)
          система выполняет сама; кнопка «Вернуть» — ручное исключение, доступна только
          суперадмину.
        </p>
      </main>
    </div>
  );
}
