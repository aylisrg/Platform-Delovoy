import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import { BookingActions } from "@/components/admin/gazebos/booking-actions";
import { AdminBookingForm } from "@/components/admin/gazebos/admin-booking-form";
import { ReceiveStockButton } from "@/components/admin/receive-stock-button";
import { ResourceEditor } from "@/components/admin/gazebos/resource-editor";

export const dynamic = "force-dynamic";

const statusLabel: Record<BookingStatus, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
};

const statusVariant: Record<BookingStatus, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
};

export default async function GazebosManagerPage() {
  const today = new Date(new Date().toISOString().split("T")[0]);

  const [resources, bookings, todayCount, pendingCount] = await Promise.all([
    prisma.resource.findMany({
      where: { moduleSlug: "gazebos" },
      orderBy: { name: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        moduleSlug: "gazebos",
        date: { gte: today },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 50,
    }),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", date: today, status: { in: ["PENDING", "CONFIRMED"] } },
    }),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", status: "PENDING" },
    }),
  ]);

  return (
    <>
      <AdminHeader title="Управление беседками" actions={<ReceiveStockButton />} />
      <div className="p-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
          <StatusWidget
            title="Беседки"
            value={resources.length}
            status="info"
            description={`${resources.filter((r) => r.isActive).length} активных`}
          />
          <StatusWidget
            title="Бронирования сегодня"
            value={todayCount}
            status={todayCount > 0 ? "success" : "info"}
          />
          <StatusWidget
            title="Ожидают подтверждения"
            value={pendingCount}
            status={pendingCount > 0 ? "warning" : "success"}
          />
        </div>

        {/* Marketing & Analytics link */}
        <div className="mb-8">
          <Link href="/admin/gazebos/marketing">
            <Card className="hover:border-zinc-300 transition-colors cursor-pointer">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-semibold text-zinc-900">📊 Реклама и аналитика</p>
                  <p className="text-sm text-zinc-500 mt-0.5">Авито · Яндекс Директ · Яндекс Бизнес</p>
                </div>
                <span className="text-zinc-400 text-lg">→</span>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Admin booking form */}
        <div className="mb-8">
          <AdminBookingForm />
        </div>

        {/* Resources */}
        <Card className="mb-8">
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Ресурсы</h2>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-zinc-500">
                  <th className="pb-3 font-medium">Название</th>
                  <th className="pb-3 font-medium">Вместимость</th>
                  <th className="pb-3 font-medium">Цена/час</th>
                  <th className="pb-3 font-medium">Статус</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-50">
                    <td className="py-3 text-zinc-900 font-medium">{r.name}</td>
                    <td className="py-3 text-zinc-600">{r.capacity ?? "—"} чел.</td>
                    <td className="py-3 text-zinc-600">{r.pricePerHour ? `${Number(r.pricePerHour)} ₽` : "—"}</td>
                    <td className="py-3">
                      <Badge variant={r.isActive ? "success" : "default"}>
                        {r.isActive ? "Активна" : "Отключена"}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <ResourceEditor resource={{ ...r, pricePerHour: r.pricePerHour != null ? Number(r.pricePerHour) : null }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Bookings */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Предстоящие бронирования</h2>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет предстоящих бронирований</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Дата</th>
                    <th className="pb-3 font-medium">Время</th>
                    <th className="pb-3 font-medium">Клиент</th>
                    <th className="pb-3 font-medium">Статус</th>
                    <th className="pb-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} className="border-b border-zinc-50">
                      <td className="py-3 text-zinc-900">
                        {new Date(b.date).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {new Date(b.startTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                        {" — "}
                        {new Date(b.endTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {(b.metadata as Record<string, unknown>)?.bookedByAdmin ? (
                          <span>
                            {(b.metadata as Record<string, unknown>)?.clientName as string ?? "—"}
                            <span className="text-xs text-zinc-400 ml-1">(админ)</span>
                          </span>
                        ) : (
                          b.user.name ?? b.user.email ?? "—"
                        )}
                      </td>
                      <td className="py-3">
                        <Badge variant={statusVariant[b.status]}>
                          {statusLabel[b.status]}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <BookingActions
                          bookingId={b.id}
                          currentStatus={b.status}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
