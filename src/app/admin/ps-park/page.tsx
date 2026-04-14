import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import type { BookingStatus } from "@prisma/client";
import { BookingActions } from "@/components/admin/ps-park/booking-actions";
import { TableEditor } from "@/components/admin/ps-park/table-editor";
import { AddItemsButton } from "@/components/admin/ps-park/add-items-button";
import { TimelineGrid } from "@/components/admin/ps-park/timeline-grid";
import { ShiftPanel } from "@/components/admin/ps-park/shift-panel";
import { ActiveSessionsPanel } from "@/components/admin/ps-park/active-sessions-panel";
import { getTimeline, getActiveSessions } from "@/modules/ps-park/service";
import { CallButton } from "@/components/admin/telephony/call-button";
import { TestAlertsButton } from "@/components/admin/ps-park/test-alerts-button";
import { BookingHistoryTable, type HistoryBooking } from "@/components/admin/ps-park/booking-history-table";

export const dynamic = "force-dynamic";

const statusLabel: Record<BookingStatus, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
  CHECKED_IN: "Идёт сеанс",
  NO_SHOW: "Не явился",
};

const statusVariant: Record<BookingStatus, "warning" | "success" | "default" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
  CHECKED_IN: "success",
  NO_SHOW: "default",
};

function formatTime(dt: Date) {
  return dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dt: Date) {
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getClientDisplay(b: {
  clientName: string | null;
  clientPhone: string | null;
  user: { name: string | null; email: string | null; phone: string | null };
}) {
  const name = b.clientName ?? b.user.name ?? b.user.email ?? "—";
  const phone = b.clientPhone ?? b.user.phone;
  return { name, phone };
}

export default async function PSParkManagerPage() {
  const now = new Date();
  const today = new Date(now.toISOString().split("T")[0]);
  const todayStr = today.toISOString().split("T")[0];

  const [
    resources,
    timelineData,
    activeSessions,
    pendingBookings,
    recentCompleted,
    todayCount,
    pendingCount,
  ] = await Promise.all([
    prisma.resource.findMany({
      where: { moduleSlug: "ps-park" },
      orderBy: { name: "asc" },
    }),
    getTimeline(todayStr),
    getActiveSessions(),
    // Pending bookings that need manager attention
    prisma.booking.findMany({
      where: {
        moduleSlug: "ps-park",
        status: "PENDING",
      },
      include: { user: { select: { name: true, email: true, phone: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 20,
    }),
    // Recent completed/cancelled for the history section
    prisma.booking.findMany({
      where: {
        moduleSlug: "ps-park",
        status: { in: ["COMPLETED", "CANCELLED"] },
      },
      include: { user: { select: { name: true, email: true, phone: true } } },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      take: 20,
    }),
    prisma.booking.count({
      where: { moduleSlug: "ps-park", date: today, status: { in: ["PENDING", "CONFIRMED"] } },
    }),
    prisma.booking.count({
      where: { moduleSlug: "ps-park", status: "PENDING" },
    }),
  ]);

  const resourceMap = new Map(resources.map((r) => [r.id, r.name]));

  return (
    <>
      <AdminHeader title="Плей Парк" actions={<TestAlertsButton />} />
      <div className="p-8">
        {/* Shift panel */}
        <ShiftPanel date={todayStr} />

        {/* Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-6">
          <StatusWidget
            title="Столы"
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

        {/* Active Sessions Panel */}
        <ActiveSessionsPanel initialSessions={activeSessions} />

        {/* Timeline Grid */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Расписание</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Кликните на свободный слот для быстрого бронирования
            </p>
          </CardHeader>
          <CardContent>
            <TimelineGrid initialData={timelineData} initialDate={todayStr} />
          </CardContent>
        </Card>

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
              <BookingTable
                bookings={pendingBookings}
                resourceMap={resourceMap}
                showAddItems
              />
            </CardContent>
          </Card>
        )}

        {/* Resources (collapsible) */}
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-700 hover:text-zinc-900 mb-3">
            Управление столами ({resources.length})
          </summary>
          <Card>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Название</th>
                    <th className="pb-3 font-medium">Игроков</th>
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
                          {r.isActive ? "Активен" : "Отключен"}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <TableEditor table={{ ...r, pricePerHour: r.pricePerHour != null ? Number(r.pricePerHour) : null }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </details>

        {/* Completed / cancelled history */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">История</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Последние 20 завершённых/отменённых — нажмите на завершённое бронирование для просмотра чека</p>
          </CardHeader>
          <CardContent>
            {recentCompleted.length === 0 ? (
              <p className="text-sm text-zinc-400">Тишина. Все геймеры сегодня дома. Или у конкурентов. Надеемся, что дома.</p>
            ) : (
              <BookingHistoryTable
                bookings={recentCompleted.map((b): HistoryBooking => ({
                  id: b.id,
                  date: b.date.toISOString(),
                  startTime: b.startTime.toISOString(),
                  endTime: b.endTime.toISOString(),
                  status: b.status,
                  clientName: b.clientName,
                  clientPhone: b.clientPhone,
                  userName: b.user.name,
                  userEmail: b.user.email,
                  userPhone: b.user.phone,
                  resourceId: b.resourceId,
                  hasBill: b.status === "COMPLETED",
                }))}
                resourceMap={Object.fromEntries(resourceMap)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ─── Shared booking table sub-component ────────────────────────────────────

type BookingRow = {
  id: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  clientName: string | null;
  clientPhone: string | null;
  metadata: unknown;
  user: { name: string | null; email: string | null; phone: string | null };
  resourceId: string;
};

function BookingTable({
  bookings,
  resourceMap,
  showAddItems = false,
}: {
  bookings: BookingRow[];
  resourceMap: Map<string, string>;
  showAddItems?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-100 text-left text-zinc-500">
          <th className="pb-3 font-medium">Дата</th>
          <th className="pb-3 font-medium">Время</th>
          <th className="pb-3 font-medium">Стол</th>
          <th className="pb-3 font-medium">Клиент</th>
          <th className="pb-3 font-medium">Статус</th>
          <th className="pb-3 font-medium">Действия</th>
        </tr>
      </thead>
      <tbody>
        {bookings.map((b) => {
          const { name, phone } = getClientDisplay(b);
          const tableName = resourceMap.get(b.resourceId) ?? "—";
          return (
            <tr key={b.id} className="border-b border-zinc-50">
              <td className="py-3 text-zinc-900">{formatDate(b.date)}</td>
              <td className="py-3 text-zinc-600 whitespace-nowrap">
                {formatTime(b.startTime)}–{formatTime(b.endTime)}
              </td>
              <td className="py-3 text-zinc-600">{tableName}</td>
              <td className="py-3 text-zinc-700">
                <div className="font-medium leading-tight">{name}</div>
                {phone && (
                  <div className="text-xs text-zinc-400 mt-0.5">{phone}</div>
                )}
                {phone && (
                  <div className="mt-1">
                    <CallButton
                      bookingId={b.id}
                      moduleSlug="ps-park"
                      clientPhone={phone}
                    />
                  </div>
                )}
              </td>
              <td className="py-3">
                <Badge variant={statusVariant[b.status]}>
                  {statusLabel[b.status]}
                </Badge>
              </td>
              <td className="py-3">
                <div className="flex items-center gap-3">
                  <BookingActions bookingId={b.id} currentStatus={b.status} />
                  {showAddItems && (
                    <AddItemsButton bookingId={b.id} />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
