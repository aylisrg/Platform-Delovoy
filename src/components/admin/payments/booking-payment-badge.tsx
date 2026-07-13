import type { BookingPaymentStatus } from "@/modules/payments/types";

/**
 * Бейдж статуса оплаты брони для админ-списков и страниц брони.
 * Чистый компонент (без "use client") — работает и в RSC, и в клиентских
 * таблицах. NONE (нет онлайн-платежа) не рисуется, чтобы POS-бронь не
 * помечалась ложным «Не оплачено».
 */

const LABELS: Record<Exclude<BookingPaymentStatus, "NONE">, string> = {
  PAID: "Оплачено",
  AWAITING: "Ожидает оплаты",
  PARTIALLY_REFUNDED: "Частичный возврат",
  REFUNDED: "Возврат",
  FAILED: "Не оплачено",
};

const COLORS: Record<Exclude<BookingPaymentStatus, "NONE">, string> = {
  PAID: "bg-green-100 text-green-700",
  AWAITING: "bg-amber-100 text-amber-700",
  PARTIALLY_REFUNDED: "bg-purple-100 text-purple-700",
  REFUNDED: "bg-purple-100 text-purple-700",
  FAILED: "bg-gray-100 text-gray-600",
};

export function BookingPaymentBadge({
  status,
}: {
  status: BookingPaymentStatus | null | undefined;
}) {
  if (!status || status === "NONE") return null;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
