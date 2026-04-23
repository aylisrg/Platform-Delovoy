import { StatusWidget } from "@/components/admin/status-widget";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { getTimeline } from "@/modules/gazebos/service";
import { GazeboTimelineGrid } from "@/components/admin/gazebos/timeline-grid";
import { GazeboMobileTimeline } from "@/components/admin/gazebos/mobile-timeline";
import { GazeboBookingListMobile } from "@/components/admin/gazebos/booking-list-mobile";
import { BookingActions as GazeboBookingActions } from "@/components/admin/gazebos/booking-actions";
import type { BookingStatus } from "@prisma/client";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified, toISODate } from "@/lib/format";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
};

const statusVariant: Record<string, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
};

function formatTime(dt: Date) {
  return formatTimeUnified(dt);
}

function formatDate(dt: Date) {
  return formatDateUnified(dt);
}

export default async function GazebosSchedulePage() {
  const today = toISODate(new Date());
  const todayDate = new Date(today);

  const [timeline, todayCount, pendingCount, pendingBookings] = await Promise.all([
    getTimeline(today),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", date: todayDate, status: { in: ["PENDING", "CONFIRMED"] } },
    }),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", status: "PENDING" },
    }),
    prisma.booking.findMany({
      where: { moduleSlug: "gazebos", status: "PENDING" },
      include: { user: { select: { name: true, email: true, phone: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 20,
    }),
  ]);

  const resourceMap = new Map(timeline.resources.map((r) => [r.id, r.name]));

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-6">
        <StatusWidget
          title="Активных беседок"
          value={timeline.resources.length}
          status="info"
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

      {/* Timeline — desktop (lg+) */}
      <Card className="mb-6 hidden lg:block">
        <CardHeader>
          <h2 className="font-semibold text-zinc-900">Расписание</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Кликните на свободный слот для быстрого бронирования
          </p>
        </CardHeader>
        <CardContent>
          <GazeboTimelineGrid initialData={timeline} initialDate={today} />
        </CardContent>
      </Card>

      {/* Timeline — mobile (< lg) */}
      <section className="mb-6 lg:hidden">
        <div className="mb-2">
          <h2 className="font-semibold text-zinc-900">Расписание</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Коснитесь свободного слота, чтобы забронировать
          </p>
        </div>
        <GazeboMobileTimeline initialData={timeline} initialDate={today} />
      </section>

      {/* Pending bookings requiring attention */}
      {pendingBookings.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-zinc-900">Ожидают подтверждения</h2>
              <Badge variant="warning">{pendingBookings.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Дата</th>
                    <th className="pb-3 font-medium">Время</th>
                    <th className="pb-3 font-medium">Беседка</th>
                    <th className="pb-3 font-medium">Клиент</th>
                    <th className="pb-3 font-medium">Статус</th>
                    <th className="pb-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBookings.map((b) => {
                    const name = b.clientName ?? b.user.name ?? b.user.email ?? "—";
                    const phone = b.clientPhone ?? b.user.phone;
                    const gazeboName = resourceMap.get(b.resourceId) ?? "—";
                    return (
                      <tr key={b.id} className="border-b border-zinc-50">
                        <td className="py-3 text-zinc-900">{formatDate(b.date)}</td>
                        <td className="py-3 text-zinc-600 whitespace-nowrap">
                          {formatTime(b.startTime)}–{formatTime(b.endTime)}
                        </td>
                        <td className="py-3 text-zinc-600">{gazeboName}</td>
                        <td className="py-3 text-zinc-700">
                          <div className="font-medium leading-tight">{name}</div>
                          {phone && (
                            <div className="text-xs text-zinc-400 mt-0.5">{phone}</div>
                          )}
                        </td>
                        <td className="py-3">
                          <Badge variant={statusVariant[b.status] ?? "default"}>
                            {statusLabel[b.status] ?? b.status}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <GazeboBookingActions bookingId={b.id} currentStatus={b.status as BookingStatus} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="lg:hidden">
              <GazeboBookingListMobile
                bookings={pendingBookings}
                resourceMap={resourceMap}
                emphasizePending
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
