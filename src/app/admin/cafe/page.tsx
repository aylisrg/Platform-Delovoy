import Link from "next/link";
import { forbidden } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import type { OrderStatus, Prisma } from "@prisma/client";
import { OrderActions } from "@/components/admin/cafe/order-actions";
import { MenuManager } from "@/components/admin/cafe/menu-manager";
import { formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const statusLabel: Record<OrderStatus, string> = {
  NEW: "Новый",
  PREPARING: "Готовится",
  READY: "Готов",
  DELIVERED: "Выдан",
  CANCELLED: "Отменён",
};

const statusVariant: Record<OrderStatus, "warning" | "success" | "default" | "info"> = {
  NEW: "warning",
  PREPARING: "info",
  READY: "success",
  DELIVERED: "default",
  CANCELLED: "default",
};

const STATUS_FILTERS: Array<{ label: string; value: OrderStatus | null }> = [
  { label: "Все", value: null },
  { label: "Новые", value: "NEW" },
  { label: "Готовятся", value: "PREPARING" },
  { label: "Готовы", value: "READY" },
  { label: "Выданы", value: "DELIVERED" },
  { label: "Отменённые", value: "CANCELLED" },
];

function ordersHref(status: string | null, paid: boolean): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (paid) params.set("paid", "true");
  const qs = params.toString();
  return qs ? `/admin/cafe?${qs}#orders` : "/admin/cafe#orders";
}

export default async function CafeManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; paid?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  const ok = await hasAdminSectionAccess(session.user.id, "cafe");
  if (!ok) forbidden();

  const { status: rawStatus, paid: rawPaid } = await searchParams;
  const statusFilter = (
    ["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"] as const
  ).find((s) => s === rawStatus) ?? null;
  const paidOnly = rawPaid === "true";

  const today = new Date(new Date().toISOString().split("T")[0]);

  const ordersWhere: Prisma.OrderWhereInput = {
    moduleSlug: "cafe",
    createdAt: { gte: today },
    ...(statusFilter && { status: statusFilter }),
    ...(paidOnly && { paidAt: { not: null } }),
  };

  const [menuItems, orders, todayCount, activeCount, todayRevenue] = await Promise.all([
    prisma.menuItem.findMany({
      where: { moduleSlug: "cafe", deletedAt: null },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.order.findMany({
      where: ordersWhere,
      include: {
        items: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.order.count({
      where: { moduleSlug: "cafe", createdAt: { gte: today } },
    }),
    prisma.order.count({
      where: { moduleSlug: "cafe", status: { in: ["NEW", "PREPARING", "READY"] } },
    }),
    prisma.order.aggregate({
      where: {
        moduleSlug: "cafe",
        deletedAt: null,
        status: { not: "CANCELLED" },
        OR: [
          { paidAt: { gte: today } },
          { paidAt: null, status: "DELIVERED", createdAt: { gte: today } },
        ],
      },
      _sum: { totalAmount: true },
    }),
  ]);

  // Имена позиций: приоритет — снапшот в OrderItem, для legacy-строк — меню.
  const menuNameMap = new Map(menuItems.map((m) => [m.id, m.name]));

  return (
    <>
      <AdminHeader title="Управление кафе" />
      <div className="p-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatusWidget
            title="Позиций в меню"
            value={menuItems.length}
            status="info"
            description={`${menuItems.filter((m) => m.isAvailable).length} на витрине`}
          />
          <StatusWidget
            title="Заказов сегодня"
            value={todayCount}
            status={todayCount > 0 ? "success" : "info"}
          />
          <StatusWidget
            title="Активных заказов"
            value={activeCount}
            status={activeCount > 0 ? "warning" : "success"}
          />
          <StatusWidget
            title="Выручка сегодня"
            value={`${Number(todayRevenue._sum.totalAmount ?? 0).toLocaleString("ru-RU")} ₽`}
            status="info"
            description="Оплаченные и выданные заказы"
            href="/admin/cafe/stats"
          />
        </div>

        {/* Быстрые ссылки */}
        <div className="mb-8 flex flex-wrap gap-3">
          <Link
            href="/admin/cafe/stats"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            📊 Статистика и отчёты
          </Link>
          <Link
            href="/admin/cafe/qr"
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
          >
            🔳 QR-код для кассы
          </Link>
        </div>

        {/* Menu catalog (CRUD) */}
        <MenuManager
          initialItems={menuItems.map((m) => ({
            id: m.id,
            category: m.category,
            name: m.name,
            description: m.description,
            price: Number(m.price),
            imageUrl: m.imageUrl,
            isAvailable: m.isAvailable,
            sortOrder: m.sortOrder,
          }))}
          canDelete={session.user.role === "SUPERADMIN"}
        />

        {/* Orders */}
        <Card id="orders">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-zinc-900">Заказы за сегодня</h2>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((f) => (
                  <Link
                    key={f.label}
                    href={ordersHref(f.value, paidOnly)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      statusFilter === f.value
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {f.label}
                  </Link>
                ))}
                <Link
                  href={ordersHref(statusFilter, !paidOnly)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    paidOnly
                      ? "bg-green-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  💳 Оплаченные
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {statusFilter || paidOnly
                  ? "По выбранным фильтрам заказов нет."
                  : "Заказов нет. Повар отдыхает, можете тоже."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-zinc-500">
                      <th className="pb-3 font-medium">Время</th>
                      <th className="pb-3 font-medium">№</th>
                      <th className="pb-3 font-medium">Клиент</th>
                      <th className="pb-3 font-medium">Позиции</th>
                      <th className="pb-3 font-medium">Сумма</th>
                      <th className="pb-3 font-medium">Оплата</th>
                      <th className="pb-3 font-medium">Доставка</th>
                      <th className="pb-3 font-medium">Статус</th>
                      <th className="pb-3 font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-zinc-50">
                        <td className="py-3 text-zinc-900">
                          {formatTime(order.createdAt)}
                        </td>
                        <td className="py-3 font-mono text-xs text-zinc-500">
                          {order.id.slice(-6).toUpperCase()}
                        </td>
                        <td className="py-3 text-zinc-600">
                          {order.user?.name ?? order.user?.email ?? "Гость"}
                        </td>
                        <td className="py-3 text-zinc-600">
                          {order.items.map((i) => (
                            <div key={i.id}>
                              {i.name ?? menuNameMap.get(i.menuItemId) ?? "—"} × {i.quantity}
                            </div>
                          ))}
                          {order.comment && (
                            <p className="mt-0.5 text-xs italic text-zinc-400">
                              «{order.comment}»
                            </p>
                          )}
                        </td>
                        <td className="py-3 text-zinc-900 font-medium">
                          {Number(order.totalAmount)} ₽
                        </td>
                        <td className="py-3">
                          {order.paidAt ? (
                            <Badge variant="success">
                              Оплачен {formatTime(order.paidAt)}
                            </Badge>
                          ) : order.status === "CANCELLED" ? (
                            <span className="text-zinc-300">—</span>
                          ) : (
                            <Badge variant="default">На кассе</Badge>
                          )}
                        </td>
                        <td className="py-3 text-zinc-600">
                          {order.deliveryTo ?? "—"}
                        </td>
                        <td className="py-3">
                          <Badge variant={statusVariant[order.status]}>
                            {statusLabel[order.status]}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <OrderActions
                            orderId={order.id}
                            currentStatus={order.status}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
