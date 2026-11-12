import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import {
  DashboardShell,
  EmptySection,
  Pagination,
} from "@/components/public/dashboard/shell";
import {
  DashboardTracking,
  TrackedDetails,
} from "@/components/public/dashboard/tracking";
import { FeedbackReply } from "@/components/public/dashboard/feedback-reply";
import { ContactsCard } from "@/components/public/profile/contacts-card";
import { NotificationSettings } from "@/components/public/notifications/notification-settings";
import {
  getDashboardBookings,
  getDashboardOrders,
  getDashboardFeedback,
} from "@/modules/profile/dashboard-service";
import { dashboardQuerySchema } from "@/modules/profile/validation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Ваши бронирования, заказы и обращения в Деловом Парке",
  robots: { index: false, follow: false },
};
const bookingLabels = {
  PENDING: "Ожидает подтверждения",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Идёт сеанс",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  NO_SHOW: "Визит не состоялся",
};
const orderLabels = {
  NEW: "Принят",
  PREPARING: "Готовится",
  READY: "Готов к выдаче",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
};
const feedbackLabels = {
  NEW: "Получено",
  IN_PROGRESS: "В работе",
  RESOLVED: "Выполнено",
  REJECTED: "Отклонено",
};
const moduleLabels: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
};
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;

function BookingCard({
  booking,
}: {
  booking: Awaited<ReturnType<typeof getDashboardBookings>>["bookings"][number];
}) {
  return (
    <Link
      href={`/dashboard/bookings/${booking.id}`}
      prefetch={false}
      className="block rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-600"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600">
          {moduleLabels[booking.moduleSlug] ?? "Бронирование"}
        </p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-700"}`}
        >
          {bookingLabels[booking.status]}
        </span>
      </div>
      <h3 className="mt-3 break-words text-lg font-semibold">{booking.resourceName}</h3>
      <p className="mt-2 text-sm text-zinc-700">
        {formatDate(booking.date)} · {formatTime(booking.startTime)}–
        {formatTime(booking.endTime)} МСК
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
        <p className="text-sm text-zinc-600">
          {booking.payment.totalDue > 0
            ? money(booking.payment.totalDue)
            : "Стоимость уточняется"}
          {booking.payment.totalDue > 0 && (
            <> · {booking.payment.shortLabel || "Без оплаты"}</>
          )}
        </p>
        <span className="text-sm font-medium text-blue-700">
          Детали и действия →
        </span>
      </div>
    </Link>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = dashboardQuerySchema.parse(raw);
  const attachEmail =
    typeof raw.attachEmail === "string" ? raw.attachEmail : undefined;
  const section = attachEmail ? "profile" : query.section;
  const session = await auth();
  if (!session?.user?.id) {
    const target = new URLSearchParams({ section });
    if (attachEmail && /^[a-f0-9]{64}$/.test(attachEmail))
      target.set("attachEmail", attachEmail);
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/dashboard?${target}`)}`,
    );
  }
  const userId = session.user.id;
  const identity = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  let content;
  if (section === "overview" || section === "bookings") {
    const active = section === "overview" || query.history === "active";
    const [{ bookings, total }, currentOrders] = await Promise.all([
      getDashboardBookings(
        userId,
        active,
        section === "overview" ? 1 : query.page,
      ),
      section === "overview"
        ? prisma.order.findMany({
            where: {
              userId,
              deletedAt: null,
              status: { in: ["NEW", "PREPARING", "READY"] },
            },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
    ]);
    content = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {section === "overview" ? "Ближайшие планы" : "Мои бронирования"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {active
                ? "Предстоящие визиты и текущие сеансы — по времени начала."
                : "Завершённые, отменённые и прошедшие бронирования."}
            </p>
          </div>
          <Link
            href="/gazebos"
            className="inline-flex min-h-11 items-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white"
          >
            Новая бронь
          </Link>
        </div>
        {section === "bookings" && (
          <nav aria-label="Период бронирований" className="flex gap-2">
            {[
              ["active", "Предстоящие"],
              ["past", "История"],
            ].map(([key, label]) => (
              <Link
                key={key}
                aria-current={query.history === key ? "page" : undefined}
                href={`/dashboard?section=bookings&history=${key}`}
                className={`rounded-xl px-4 py-3 text-sm ${query.history === key ? "bg-blue-50 font-medium text-blue-800" : "bg-white text-zinc-600"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        {bookings.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(section === "overview" ? bookings.slice(0, 3) : bookings).map(
              (b) => (
                <BookingCard key={b.id} booking={b} />
              ),
            )}
          </div>
        ) : (
          <EmptySection
            title={
              active
                ? "Пока нет предстоящих визитов"
                : "Здесь будет история ваших визитов"
            }
            description={
              active
                ? "Выберите беседку для встречи или стол в Плей Парке. Ваши брони появятся здесь."
                : "Завершённые и отменённые брони можно будет найти в этом разделе."
            }
            href="/ps-park"
            action="Выбрать время в Плей Парке"
          />
        )}
        {currentOrders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Заказы в работе</h2>
            {currentOrders.map((order) => (
              <Link
                key={order.id}
                href="/dashboard?section=orders"
                className="flex flex-wrap justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm"
              >
                <span>
                  Кафе · {formatTime(order.createdAt)} ·{" "}
                  {money(Number(order.totalAmount))}
                </span>
                <span className="font-medium text-blue-700">
                  {orderLabels[order.status]} →
                </span>
              </Link>
            ))}
          </section>
        )}
        {section === "bookings" ? (
          <Pagination
            page={query.page}
            total={total}
            section="bookings"
            history={query.history}
          />
        ) : (
          <>
            <Link
              href="/dashboard?section=bookings"
              className="inline-block py-2 text-sm font-medium text-blue-700"
            >
              Все бронирования и история →
            </Link>
            <section
              className="grid gap-3 sm:grid-cols-3"
              aria-label="Сервисы парка"
            >
              {[
                ["/cafe", "Заказать в кафе", "Меню и доставка в офис"],
                [
                  "/dashboard?section=orders",
                  "Мои заказы",
                  "Состав и статус приготовления",
                ],
                [
                  "/dashboard?section=feedback",
                  "Связаться с парком",
                  "Обращения и ответы сотрудников",
                ],
              ].map(([href, title, text]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-2xl border border-zinc-200 bg-white p-5 hover:border-blue-400"
                >
                  <h3 className="font-semibold">{title} →</h3>
                  <p className="mt-2 text-sm text-zinc-600">{text}</p>
                </Link>
              ))}
            </section>
          </>
        )}
      </div>
    );
  } else if (section === "orders") {
    const { orders, total } = await getDashboardOrders(userId, query.page);
    content = (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Мои заказы</h2>
        {orders.map((order) => (
          <TrackedDetails
            key={order.id}
            title={
              <>
                <span className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">
                    Заказ от {formatDate(order.createdAt)} ·{" "}
                    {formatTime(order.createdAt)}
                  </span>
                  <span className="text-sm text-zinc-600">
                    {orderLabels[order.status]}
                  </span>
                </span>
                <span className="mt-2 block text-sm text-zinc-600">
                  {order.items.length} поз. ·{" "}
                  {order.items.reduce((n, item) => n + item.quantity, 0)} шт. ·{" "}
                  {money(Number(order.totalAmount))}
                </span>
              </>
            }
          >
            <ul className="divide-y divide-zinc-100">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                >
                  <span className="min-w-0 break-words">
                    {item.name ?? "Позиция меню"} × {item.quantity}
                  </span>
                  <span>{money(Number(item.price) * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-zinc-600">
              {order.deliveryTo
                ? `Доставка: офис ${order.deliveryTo}`
                : "Самовывоз"}
            </p>
            <p className="mt-2 text-sm text-zinc-600">
              {order.paidAt
                ? "Оплата онлайн подтверждена"
                : "Онлайн-оплата не подтверждена"}
            </p>
            {order.comment && (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                {order.comment}
              </p>
            )}
          </TrackedDetails>
        ))}
        {!orders.length && (
          <EmptySection
            title="Заказов пока нет"
            description="Посмотрите меню кафе — здесь появятся состав заказа и статус приготовления."
            href="/cafe"
            action="Открыть меню кафе"
          />
        )}
        <Pagination section="orders" page={query.page} total={total} />
      </section>
    );
  } else if (section === "feedback") {
    const { items, total } = await getDashboardFeedback(userId, query.page);
    content = (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Мои обращения</h2>
          <Link
            href="/report"
            className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white"
          >
            Новое обращение
          </Link>
        </div>
        {items.map((item) => (
          <TrackedDetails
            feedback
            key={item.id}
            title={
              <>
                <span className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">
                    {item.type === "BUG"
                      ? "Сообщение о проблеме"
                      : "Предложение"}{" "}
                    · {formatDate(item.createdAt)}
                  </span>
                  <span className="text-sm text-zinc-600">
                    {feedbackLabels[item.status]}
                  </span>
                </span>
                <span className="mt-3 line-clamp-2 block break-words text-sm text-zinc-600">
                  {item.description}
                </span>
              </>
            }
          >
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {item.description}
            </p>
            {item.screenshotPath && (
              <a
                href={`/api/feedback/uploads/${encodeURIComponent(item.screenshotPath)}`}
                className="mt-3 inline-block py-2 text-sm text-blue-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть вложение →
              </a>
            )}
            <ol className="mt-5 space-y-3" aria-label="Переписка по обращению">
              {item.comments.map((c) => (
                <li key={c.id} className="rounded-xl bg-zinc-50 p-4">
                  <p className="text-xs font-medium text-zinc-600">
                    {c.authorLabel} · {formatDate(c.createdAt)}{" "}
                    {formatTime(c.createdAt)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {c.text}
                  </p>
                </li>
              ))}
            </ol>
            <FeedbackReply feedbackId={item.id} />
          </TrackedDetails>
        ))}
        {!items.length && (
          <EmptySection
            title="Обращений пока нет"
            description="Расскажите о проблеме или предложите улучшение. Ответы сотрудников появятся здесь."
            href="/report"
            action="Написать в парк"
          />
        )}
        <Pagination section="feedback" page={query.page} total={total} />
      </section>
    );
  } else {
    content = (
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Профиль и контакты</h2>
          <p className="mb-6 mt-2 text-sm leading-relaxed text-zinc-600">
            Настройте имя и контакты. Email и Telegram также помогают войти в
            аккаунт.
          </p>
          <ContactsCard initialEmailToken={attachEmail} />
        </section>
        <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="mb-6 text-xl font-semibold">Уведомления</h2>
          <NotificationSettings />
        </section>
      </div>
    );
  }
  return (
    <DashboardShell
      name={identity?.name ?? null}
      role={session.user.role}
      section={section}
    >
      <DashboardTracking section={section} />
      {content}
    </DashboardShell>
  );
}
