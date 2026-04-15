import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import { getTimeline } from "@/modules/gazebos/service";
import { GazeboTimelineGrid } from "@/components/admin/gazebos/timeline-grid";

export const dynamic = "force-dynamic";

export default async function GazebosSchedulePage() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const todayDate = new Date(today);

  const [timeline, todayCount, pendingCount] = await Promise.all([
    getTimeline(today),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", date: todayDate, status: { in: ["PENDING", "CONFIRMED"] } },
    }),
    prisma.booking.count({
      where: { moduleSlug: "gazebos", status: "PENDING" },
    }),
  ]);

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
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

      {/* Timeline Grid */}
      <GazeboTimelineGrid initialData={timeline} initialDate={today} />
    </>
  );
}
