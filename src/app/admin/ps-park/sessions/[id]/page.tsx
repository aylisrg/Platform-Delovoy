import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasRole, hasAdminSectionAccess } from "@/lib/permissions";
import { getSessionDetail } from "@/modules/ps-park/service";
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
  CHECKED_IN: "Идёт сеанс",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
  NO_SHOW: "Не явился",
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Наличными",
  CARD: "Безналичными",
  MIXED: "Смешанная (нал. + безнал.)",
  SUBSCRIPTION: "Абонемент",
  FREE: "Бесплатно",
};

const PAYMENT_COLOR: Record<string, string> = {
  CASH: "bg-emerald-100 text-emerald-700",
  CARD: "bg-blue-100 text-blue-700",
  MIXED: "bg-purple-100 text-purple-700",
  SUBSCRIPTION: "bg-amber-100 text-amber-700",
  FREE: "bg-zinc-100 text-zinc-600",
};

function formatTime(iso: string) {
  return formatTimeUnified(iso);
}

function formatDate(iso: string) {
  return formatDateUnified(iso);
}

function formatMoney(n: number) {
  return n.toLocaleString("ru-RU") + " ₽";
}

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  // RBAC: SUPERADMIN/ADMIN автодоступ; MANAGER — только при grant.
  if (
    session.user.role !== "SUPERADMIN" &&
    session.user.role !== "ADMIN" &&
    !hasRole(session.user, "MANAGER")
  ) {
    notFound();
  }
  if (
    session.user.role === "MANAGER" &&
    !(await hasAdminSectionAccess(session.user.id, "ps-park"))
  ) {
    notFound();
  }

  const { id } = await params;
  const detail = await getSessionDetail(id);
  if (!detail) notFound();

  const { session: sess, orders, payment } = detail;
  const ordersTotal = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const grandTotal = sess.totalBill + ordersTotal;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link
          href="/admin/ps-park"
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← Назад в Плей Парк
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            Сессия {sess.resource?.name ?? "—"}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {formatDate(sess.date)} · {formatTime(sess.startTime)} – {formatTime(sess.endTime)} · {formatDuration(sess.durationMin)}
          </p>
        </div>
        <span className="inline-block rounded-full px-3 py-1 text-xs font-medium bg-zinc-100 text-zinc-700">
          {STATUS_LABEL[sess.status] ?? sess.status}
        </span>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Гость</h2>
        <div className="space-y-1">
          <p className="text-lg font-medium text-zinc-900">
            {sess.client.userId ? (
              <Link
                href={`/admin/clients/${sess.client.userId}`}
                className="text-blue-600 hover:underline"
              >
                {sess.client.name ?? "—"}
              </Link>
            ) : (
              <>
                {sess.client.name ?? "Гость без аккаунта"}{" "}
                <span className="text-xs text-zinc-400">(без userId)</span>
              </>
            )}
          </p>
          {sess.client.phone && (
            <p className="text-sm text-zinc-600">📞 {sess.client.phone}</p>
          )}
          {sess.client.email && (
            <p className="text-sm text-zinc-600">✉ {sess.client.email}</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Игра</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-zinc-500">Стол</p>
            <p className="font-medium text-zinc-900">{sess.resource?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Тариф</p>
            <p className="font-medium text-zinc-900">
              {formatMoney(sess.resource?.pricePerHour ?? 0)}/ч
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Часов оплачено</p>
            <p className="font-medium text-zinc-900 tabular-nums">{sess.billedHours} ч</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">
          Кафе-заказы ({orders.length})
        </h2>
        {orders.length === 0 ? (
          <p className="text-sm text-zinc-400">Заказов в кафе не было</p>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="rounded-lg border border-zinc-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-zinc-500">
                    {formatDateTime(o.createdAt)} · {o.status}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(o.totalAmount)}
                  </span>
                </div>
                <ul className="space-y-1">
                  {o.items.map((it, i) => (
                    <li
                      key={i}
                      className="flex justify-between text-sm text-zinc-700"
                    >
                      <span>
                        {it.name} × {it.quantity}
                      </span>
                      <span className="tabular-nums">{formatMoney(it.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex justify-between border-t border-zinc-200 pt-2 font-semibold">
              <span>Всего по кафе</span>
              <span className="tabular-nums">{formatMoney(ordersTotal)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Оплата</h2>
        <div className="flex items-center justify-between mb-3">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${PAYMENT_COLOR[payment.method]}`}
          >
            {PAYMENT_LABEL[payment.method] ?? payment.method}
          </span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(payment.totalAmount)}
          </span>
        </div>

        {payment.method === "SUBSCRIPTION" && payment.subscription && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-1">
            <p className="font-medium text-amber-900">
              Списано {payment.subscription.hoursDebited} ч с абонемента
            </p>
            <p className="text-amber-700">
              Остаток после: {payment.subscription.balanceAfter} ч ·{" "}
              <Link
                href={`/admin/ps-park/subscriptions/${payment.subscription.subscriptionId}`}
                className="underline"
              >
                Открыть абонемент
              </Link>
            </p>
          </div>
        )}

        {(payment.method === "CASH" ||
          payment.method === "CARD" ||
          payment.method === "MIXED") && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
              <p className="text-xs text-emerald-700">💵 Наличные</p>
              <p className="font-semibold tabular-nums text-emerald-900">
                {formatMoney(payment.cashAmount)}
              </p>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-2">
              <p className="text-xs text-blue-700">💳 Безналичные</p>
              <p className="font-semibold tabular-nums text-blue-900">
                {formatMoney(payment.cardAmount)}
              </p>
            </div>
          </div>
        )}

        {payment.online && (
          <div className="mt-3 rounded-lg bg-green-50 border border-green-100 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-green-700">
                💳 Онлайн-оплата (ЮKassa)
                <BookingPaymentBadge status={payment.online.status} />
              </span>
              {payment.online.amount > 0 && (
                <span className="font-semibold tabular-nums text-green-900">
                  {formatMoney(payment.online.amount)}
                </span>
              )}
            </div>
            {payment.online.paidAt && (
              <p className="text-xs text-green-600 mt-1">
                {formatDateTime(payment.online.paidAt)}
              </p>
            )}
          </div>
        )}

        {payment.discount && (
          <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm">
            <p className="font-medium">
              Скидка {payment.discount.percent}% (−{formatMoney(payment.discount.amount)})
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Причина: {payment.discount.reason}
            </p>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-zinc-200 flex justify-between text-sm">
          <span className="text-zinc-500">Сессия + кафе</span>
          <span className="font-semibold tabular-nums">{formatMoney(grandTotal)}</span>
        </div>
      </section>
    </div>
  );
}
