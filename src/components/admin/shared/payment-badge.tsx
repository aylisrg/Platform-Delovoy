import {
  getBookingPaymentSummary,
  type BookingPaymentState,
  type PaymentSummaryInput,
} from "@/modules/booking/payment-status";

const STYLES: Record<BookingPaymentState, string> = {
  PAID: "bg-emerald-600 text-white",
  PARTIAL: "bg-amber-100 text-amber-800 border border-amber-300",
  UNPAID: "bg-zinc-100 text-zinc-600 border border-zinc-300",
  PENALTY_HELD: "bg-orange-100 text-orange-800 border border-orange-300",
  FREE: "bg-zinc-100 text-zinc-500 border border-zinc-200",
};

type Props = {
  booking: PaymentSummaryInput;
  /** compact — для тесной сетки расписания. */
  size?: "default" | "compact";
  /** Показывать ли бейдж у броней без счёта. По умолчанию нет — шум. */
  showFree?: boolean;
};

/**
 * Признак оплаты рядом со статусом жизненного цикла брони.
 *
 * Владелец просил «писать ОПЛАЧЕНО в брони и в статусе, это самый высший
 * статус». В данных это не значение `BookingStatus`, а производная от денег
 * (см. `payment-status.ts`), но на экране выглядит ровно так, как он просил —
 * отдельный заметный бейдж, самый контрастный из всех в зелёном.
 */
export function PaymentBadge({ booking, size = "default", showFree = false }: Props) {
  const summary = getBookingPaymentSummary(booking);
  if (summary.state === "FREE" && !showFree) return null;

  const text = size === "compact" ? summary.shortLabel : summary.label;
  if (!text) return null;

  const sizeClass =
    size === "compact" ? "text-[10px] px-1.5 py-0" : "text-xs px-2 py-0.5";

  return (
    <span
      title={
        summary.state === "PARTIAL"
          ? `Остаток к оплате: ${Math.round(summary.outstanding).toLocaleString("ru-RU")} ₽`
          : undefined
      }
      className={`inline-block whitespace-nowrap rounded-full font-semibold ${sizeClass} ${STYLES[summary.state]}`}
    >
      {text}
    </span>
  );
}
