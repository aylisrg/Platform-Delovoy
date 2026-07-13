import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRole, hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getBooking } from "@/modules/gazebos/service";
import { getBookingPaymentDetail } from "@/modules/payments/service";
import { BookingPaymentBadge } from "@/components/admin/payments/booking-payment-badge";
import {
  formatDate as formatDateUnified,
  formatTime as formatTimeUnified,
  formatDateTime,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Заехал",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
  NO_SHOW: "Не явился",
};

const METHOD_LABEL: Record<string, string> = {
  bank_card: "Банковская карта",
  sbp: "СБП",
  sberbank: "SberPay",
  tinkoff_bank: "T-Pay",
  yoo_money: "ЮMoney",
};

function formatMoney(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

export default async function GazeboBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  // RBAC: SUPERADMIN/ADMIN автодоступ; MANAGER — только при grant на секцию.
  if (
    session.user.role !== "SUPERADMIN" &&
    session.user.role !== "ADMIN" &&
    !hasRole(session.user, "MANAGER")
  ) {
    notFound();
  }
  if (
    session.user.role === "MANAGER" &&
    !(await hasAdminSectionAccess(session.user.id, "gazebos"))
  ) {
    notFound();
  }

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) notFound();

  const [resource, paymentDetail] = await Promise.all([
    prisma.resource.findUnique({
      where: { id: booking.resourceId },
      select: { name: true },
    }),
    getBookingPaymentDetail(id),
  ]);

  const meta = (booking.metadata as Record<string, unknown> | null) ?? {};
  const totalPrice = Number(meta.totalPrice ?? 0);
  const guestCount = meta.guestCount as number | undefined;
  const comment = meta.comment as string | undefined;
  const cash = Number(booking.cashAmount ?? 0);
  const card = Number(booking.cardAmount ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link
          href="/admin/gazebos/bookings"
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← Назад к бронированиям
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            {resource?.name ?? "Беседка"}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {formatDateUnified(booking.date.toISOString())} ·{" "}
            {formatTimeUnified(booking.startTime.toISOString())} –{" "}
            {formatTimeUnified(booking.endTime.toISOString())}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="inline-block rounded-full px-3 py-1 text-xs font-medium bg-zinc-100 text-zinc-700">
            {STATUS_LABEL[booking.status] ?? booking.status}
          </span>
          <BookingPaymentBadge status={paymentDetail?.status ?? "NONE"} />
        </div>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Клиент</h2>
        <div className="space-y-1 text-sm">
          <p className="text-lg font-medium text-zinc-900">
            {booking.clientName ?? "Гость без имени"}
          </p>
          {booking.clientPhone && (
            <p className="text-zinc-600">📞 {booking.clientPhone}</p>
          )}
          {typeof guestCount === "number" && (
            <p className="text-zinc-600">Гостей: {guestCount}</p>
          )}
          {comment && <p className="text-zinc-500">Комментарий: {comment}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Оплата</h2>
        <div className="flex items-center justify-between mb-3">
          <BookingPaymentBadge status={paymentDetail?.status ?? "NONE"} />
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(totalPrice)}
          </span>
        </div>

        {paymentDetail ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-green-50 border border-green-100 p-2">
                <p className="text-xs text-green-700">💳 Оплачено онлайн</p>
                <p className="font-semibold tabular-nums text-green-900">
                  {formatMoney(Number(paymentDetail.amount))}
                </p>
              </div>
              <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-2">
                <p className="text-xs text-zinc-500">Способ</p>
                <p className="font-medium text-zinc-900">
                  {paymentDetail.paymentMethodType
                    ? METHOD_LABEL[paymentDetail.paymentMethodType] ??
                      paymentDetail.paymentMethodType
                    : "—"}
                </p>
              </div>
            </div>
            {paymentDetail.paidAt && (
              <p className="text-xs text-zinc-500">
                Оплачено: {formatDateTime(paymentDetail.paidAt)}
              </p>
            )}
            {Number(paymentDetail.refundedAmount) > 0 && (
              <p className="text-sm text-purple-700">
                Возвращено: {formatMoney(Number(paymentDetail.refundedAmount))}
              </p>
            )}
            {paymentDetail.payments.some((p) => p.refunds.length > 0) && (
              <div className="rounded-lg bg-purple-50 border border-purple-100 p-3">
                <p className="text-xs font-medium text-purple-800 mb-1">Возвраты</p>
                <ul className="space-y-1">
                  {paymentDetail.payments.flatMap((p) =>
                    p.refunds.map((r) => (
                      <li
                        key={r.id}
                        className="flex justify-between text-xs text-purple-700"
                      >
                        <span>
                          {formatDateTime(r.createdAt.toISOString())} · {r.reason}
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(Number(r.amount))}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : cash > 0 || card > 0 ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
              <p className="text-xs text-emerald-700">💵 Наличные</p>
              <p className="font-semibold tabular-nums text-emerald-900">
                {formatMoney(cash)}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-2">
              <p className="text-xs text-blue-700">💳 Безналичные</p>
              <p className="font-semibold tabular-nums text-blue-900">
                {formatMoney(card)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">Оплата не проведена</p>
        )}
      </section>
    </div>
  );
}
