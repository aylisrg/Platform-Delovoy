import { AdminHeader } from "@/components/admin/header";
import { StatusWidget } from "@/components/admin/status-widget";

export default function DashboardPage() {
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
            value="5"
            status="info"
            description="из 5 доступных"
          />
          <StatusWidget
            title="Бронирования сегодня"
            value="0"
            description="Нет данных"
          />
          <StatusWidget
            title="Заказы сегодня"
            value="0"
            description="Нет данных"
          />
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-900">Быстрый доступ</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
