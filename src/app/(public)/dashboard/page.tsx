import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotificationSettings } from "@/components/public/notifications/notification-settings";
import type { BookingStatus, OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const bookingStatusLabel: Record<BookingStatus, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  CHECKED_IN: "Идёт сеанс",
  NO_SHOW: "Не явился",
};

const bookingStatusVariant: Record<BookingStatus, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
  CHECKED_IN: "success",
  NO_SHOW: "default",
};

const orderStatusLabel: Record<OrderStatus, string> = {
  NEW: "Новый",
  PREPARING: "Готовится",
  READY: "Готов",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
};

const orderStatusVariant: Record<OrderStatus, "warning" | "success" | "default" | "info"> = {
  NEW: "warning",
  PREPARING: "info",
  READY: "success",
  DELIVERED: "default",
  CANCELLED: "default",
};

const moduleLabels: Record<string, string> = {
  gazebos: "Беседки",
  "ps-park": "PS Park",
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const userId = session.user.id;

  const [bookings, orders] = await Promise.all([
    prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // Look up resource names for bookings
  const resourceIds = [...new Set(bookings.map((b) => b.resourceId))];
  const resources = resourceIds.length > 0
    ? await prisma.resource.findMany({
        where: { id: { in: resourceIds } },
        select: { id: true, name: true },
      })
    : [];
  const resourceNameMap = new Map(resources.map((r) => [r.id, r.name]));

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </Link>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">Личный кабинет</h1>
          <p className="mt-2 text-zinc-600">
            {session.user.name ?? session.user.email ?? "Пользователь"}
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Bookings */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Мои бронирования</h2>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="text-sm text-zinc-400">У вас пока нет бронирований</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Модуль</th>
                    <th className="pb-3 font-medium">Ресурс</th>
                    <th className="pb-3 font-medium">Дата</th>
                    <th className="pb-3 font-medium">Время</th>
                    <th className="pb-3 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-b border-zinc-50">
                      <td className="py-3 text-zinc-600">
                        {moduleLabels[b.moduleSlug] ?? b.moduleSlug}
                      </td>
                      <td className="py-3 text-zinc-900 font-medium">
                        {resourceNameMap.get(b.resourceId) ?? "—"}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {new Date(b.date).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {new Date(b.startTime).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" — "}
                        {new Date(b.endTime).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3">
                        <Badge variant={bookingStatusVariant[b.status]}>
                          {bookingStatusLabel[b.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Orders */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Мои заказы</h2>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-zinc-400">У вас пока нет заказов</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Дата</th>
                    <th className="pb-3 font-medium">Позиций</th>
                    <th className="pb-3 font-medium">Сумма</th>
                    <th className="pb-3 font-medium">Доставка</th>
                    <th className="pb-3 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-zinc-50">
                      <td className="py-3 text-zinc-600">
                        {new Date(o.createdAt).toLocaleDateString("ru-RU")}{" "}
                        {new Date(o.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {o.items.length} шт.
                      </td>
                      <td className="py-3 text-zinc-900 font-medium">
                        {Number(o.totalAmount)} ₽
                      </td>
                      <td className="py-3 text-zinc-600">
                        {o.deliveryTo ?? "—"}
                      </td>
                      <td className="py-3">
                        <Badge variant={orderStatusVariant[o.status]}>
                          {orderStatusLabel[o.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Настройки уведомлений</h2>
          </CardHeader>
          <CardContent>
            <NotificationSettings />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
