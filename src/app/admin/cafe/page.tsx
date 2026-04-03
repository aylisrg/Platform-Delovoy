import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import type { OrderStatus } from "@prisma/client";
import { OrderActions } from "@/components/admin/cafe/order-actions";

export const dynamic = "force-dynamic";

const statusLabel: Record<OrderStatus, string> = {
  NEW: "Новый",
  PREPARING: "Готовится",
  READY: "Готов",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
};

const statusVariant: Record<OrderStatus, "warning" | "success" | "default" | "info"> = {
  NEW: "warning",
  PREPARING: "info",
  READY: "success",
  DELIVERED: "default",
  CANCELLED: "default",
};

export default async function CafeManagerPage() {
  const today = new Date(new Date().toISOString().split("T")[0]);

  const [menuItems, orders, todayCount, activeCount] = await Promise.all([
    prisma.menuItem.findMany({
      where: { moduleSlug: "cafe" },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.order.findMany({
      where: {
        moduleSlug: "cafe",
        createdAt: { gte: today },
      },
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
  ]);

  // Build menu item name lookup
  const menuNameMap = new Map(menuItems.map((m) => [m.id, m.name]));

  return (
    <>
      <AdminHeader title="Управление кафе" />
      <div className="p-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-8">
          <StatusWidget
            title="Позиций в меню"
            value={menuItems.length}
            status="info"
            description={`${menuItems.filter((m) => m.isAvailable).length} доступных`}
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
        </div>

        {/* Menu items */}
        <Card className="mb-8">
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Меню</h2>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-zinc-500">
                  <th className="pb-3 font-medium">Категория</th>
                  <th className="pb-3 font-medium">Название</th>
                  <th className="pb-3 font-medium">Цена</th>
                  <th className="pb-3 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {menuItems.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-50">
                    <td className="py-3 text-zinc-500">{item.category}</td>
                    <td className="py-3 text-zinc-900 font-medium">{item.name}</td>
                    <td className="py-3 text-zinc-600">{Number(item.price)} ₽</td>
                    <td className="py-3">
                      <Badge variant={item.isAvailable ? "success" : "default"}>
                        {item.isAvailable ? "Доступно" : "Скрыто"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Orders */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Заказы за сегодня</h2>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет заказов за сегодня</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Время</th>
                    <th className="pb-3 font-medium">Клиент</th>
                    <th className="pb-3 font-medium">Позиции</th>
                    <th className="pb-3 font-medium">Сумма</th>
                    <th className="pb-3 font-medium">Доставка</th>
                    <th className="pb-3 font-medium">Статус</th>
                    <th className="pb-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-zinc-50">
                      <td className="py-3 text-zinc-900">
                        {new Date(order.createdAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {order.user.name ?? order.user.email ?? "—"}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {order.items.map((i) => (
                          <div key={i.id}>
                            {menuNameMap.get(i.menuItemId) ?? "—"} × {i.quantity}
                          </div>
                        ))}
                      </td>
                      <td className="py-3 text-zinc-900 font-medium">
                        {Number(order.totalAmount)} ₽
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
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
