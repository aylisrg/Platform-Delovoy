import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getDashboardStats() {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [activeModules, totalModules, bookingsToday, ordersToday] = await Promise.all([
      prisma.module.count({ where: { isActive: true } }),
      prisma.module.count(),
      prisma.booking.count({
        where: { date: { gte: todayStart }, status: { not: "CANCELLED" } },
      }),
      prisma.order.count({
        where: { createdAt: { gte: todayStart }, status: { not: "CANCELLED" } },
      }),
    ]);

    return { activeModules, totalModules, bookingsToday, ordersToday };
  } catch {
    return { activeModules: 0, totalModules: 0, bookingsToday: 0, ordersToday: 0 };
  }
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <>
      <AdminHeader title="Дашборд" />
      <div className="p-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatusWidget
            title="Статус системы"
            value="Онлайн"
            status="success"
            description="Все сервисы работают"
          />
          <StatusWidget
            title="Активные модули"
            value={stats.activeModules}
            status="info"
            description={`из ${stats.totalModules} доступных`}
          />
          <StatusWidget
            title="Бронирования сегодня"
            value={stats.bookingsToday}
            description="беседки + PS Park"
          />
          <StatusWidget
            title="Заказы сегодня"
            value={stats.ordersToday}
            description="кафе"
          />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-900">Быстрый доступ</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <QuickLink href="/admin/architect" title="Архитектор" description="Карта системы, конфиг, аналитика" />
            <QuickLink href="/admin/modules" title="Модули" description="Управление модулями платформы" />
            <QuickLink href="/admin/monitoring" title="Мониторинг" description="Статус системы и логи" />
            <QuickLink href="/admin/users" title="Пользователи" description="Управление пользователями и ролями" />
          </div>
        </div>
      </div>
    </>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </a>
  );
}
