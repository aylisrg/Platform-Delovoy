"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { MergeDialog } from "./merge-dialog";
import { formatDate as formatDateUnified, formatTime as formatTimeUnified } from "@/lib/format";

type ModuleUsage = {
  moduleSlug: string;
  moduleName: string;
  firstUsedAt: string;
  count: number;
  totalSpent: number;
};

type ClientBooking = {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  amount: number;
  createdAt: string;
};

type ClientOrder = {
  id: string;
  moduleSlug: string;
  status: string;
  totalAmount: number;
  itemCount: number;
  deliveryTo: string | null;
  createdAt: string;
};

type ActivityEvent = {
  id: string;
  type: "booking" | "order";
  moduleSlug: string;
  action: string;
  description: string;
  amount: number | null;
  createdAt: string;
};

type MonthlySpending = {
  month: string;
  bookingsSpent: number;
  ordersSpent: number;
  total: number;
};

type ClientDetail = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  vkId: string | null;
  createdAt: string;
  modulesUsed: ModuleUsage[];
  totalSpent: number;
  bookingCount: number;
  orderCount: number;
  lastActivityAt: string | null;
  authProviders: string[];
  bookings: ClientBooking[];
  orders: ClientOrder[];
  activityTimeline: ActivityEvent[];
  spendingByMonth: MonthlySpending[];
};

const MODULE_ICONS: Record<string, string> = {
  gazebos: "🏕",
  "ps-park": "🎮",
  cafe: "☕",
};

const PROVIDER_LABEL: Record<string, { icon: string; label: string; color: string }> = {
  telegram: { icon: "TG", label: "Telegram", color: "bg-sky-100 text-sky-700" },
  google: { icon: "G", label: "Google", color: "bg-red-50 text-red-600" },
  vk: { icon: "VK", label: "VKontakte", color: "bg-blue-100 text-blue-700" },
  yandex: { icon: "Ya", label: "Yandex", color: "bg-yellow-100 text-yellow-700" },
  credentials: { icon: "@", label: "Email", color: "bg-zinc-100 text-zinc-600" },
};

const BOOKING_STATUS_LABEL: Record<string, string> = {
  PENDING: "Ожидает",
  CONFIRMED: "Подтверждено",
  CANCELLED: "Отменено",
  COMPLETED: "Завершено",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  NEW: "Новый",
  PREPARING: "Готовится",
  READY: "Готов",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
};

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "default",
  COMPLETED: "info",
  NEW: "warning",
  PREPARING: "info",
  READY: "success",
  DELIVERED: "success",
};

function formatRubles(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return formatDateUnified(iso);
}

function formatTime(iso: string): string {
  return formatTimeUnified(iso);
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  const monthNames = [
    "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
    "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
  ];
  return `${monthNames[parseInt(m) - 1]} ${year}`;
}

export function ClientProfile({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"timeline" | "bookings" | "orders" | "spending">("timeline");
  const [showMerge, setShowMerge] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setClient(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-zinc-400">Загрузка...</div>
    );
  }

  if (!client) {
    return (
      <div className="py-12 text-center">
        <p className="text-zinc-400">Клиент не найден</p>
        <Link
          href="/admin/users?tab=clients"
          className="mt-2 inline-block text-sm text-blue-600 hover:underline"
        >
          Вернуться к списку
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/users?tab=clients"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
      >
        ← Все клиенты
      </Link>

      {/* Client header */}
      <div className="flex items-start gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        {client.image ? (
          <Image
            src={client.image}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-xl font-bold text-zinc-600">
            {(client.name || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <h2 className="text-xl font-bold text-zinc-900">
            {client.name || "Без имени"}
          </h2>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
            {client.email && <span>{client.email}</span>}
            {client.phone && <span>{client.phone}</span>}
            {client.telegramId && <span>Telegram: {client.telegramId}</span>}
            {client.vkId && <span>VK: {client.vkId}</span>}
          </div>
          {client.authProviders && client.authProviders.length > 0 && (
            <div className="flex gap-1.5 mt-1.5">
              {client.authProviders.map((p) => {
                const info = PROVIDER_LABEL[p];
                return (
                  <span
                    key={p}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${info?.color || "bg-zinc-100 text-zinc-600"}`}
                    title={info?.label || p}
                  >
                    {info?.icon || p} {info?.label || p}
                  </span>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            Клиент с {formatDate(client.createdAt)}
          </p>
        </div>
        <button
          onClick={() => setShowMerge(true)}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          Объединить
        </button>
      </div>

      {showMerge && (
        <MergeDialog
          primaryId={client.id}
          primaryName={client.name || "Без имени"}
          onMerged={() => {
            setShowMerge(false);
            router.refresh();
          }}
          onClose={() => setShowMerge(false)}
        />
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Всего потрачено" value={formatRubles(client.totalSpent)} />
        <SummaryCard label="Бронирований" value={String(client.bookingCount)} />
        <SummaryCard label="Заказов" value={String(client.orderCount)} />
        <SummaryCard
          label="Последняя активность"
          value={client.lastActivityAt ? formatDate(client.lastActivityAt) : "—"}
        />
      </div>

      {/* Module usage */}
      {client.modulesUsed.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {client.modulesUsed.map((m) => (
            <div
              key={m.moduleSlug}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">
                  {MODULE_ICONS[m.moduleSlug]}
                </span>
                <span className="font-semibold text-zinc-900">
                  {m.moduleName}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-zinc-600">
                  <span>Взаимодействий</span>
                  <span className="font-medium">{m.count}</span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>Потрачено</span>
                  <span className="font-medium">
                    {formatRubles(m.totalSpent)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Первое использование</span>
                  <span>{formatDate(m.firstUsedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-zinc-200">
        <div className="flex gap-6">
          {(
            [
              { key: "timeline", label: "Активность" },
              { key: "bookings", label: `Бронирования (${client.bookingCount})` },
              { key: "orders", label: `Заказы (${client.orderCount})` },
              { key: "spending", label: "Траты по месяцам" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === "timeline" && (
        <TimelineTab events={client.activityTimeline} />
      )}
      {tab === "bookings" && <BookingsTab bookings={client.bookings} />}
      {tab === "orders" && <OrdersTab orders={client.orders} />}
      {tab === "spending" && (
        <SpendingTab months={client.spendingByMonth} />
      )}
    </div>
  );
}

function TimelineTab({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">Нет активности</p>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div
          key={`${event.type}-${event.id}`}
          className="flex items-center gap-4 rounded-lg border border-zinc-100 bg-white px-4 py-3"
        >
          <span className="text-lg">
            {event.type === "booking" ? "📅" : "🛒"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-900 truncate">
              {event.description}
            </p>
            <p className="text-xs text-zinc-400">{event.action}</p>
          </div>
          {event.amount !== null && event.amount > 0 && (
            <span className="text-sm font-medium text-zinc-900">
              {formatRubles(event.amount)}
            </span>
          )}
          <span className="text-xs text-zinc-400 whitespace-nowrap">
            {formatDate(event.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BookingsTab({ bookings }: { bookings: ClientBooking[] }) {
  if (bookings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        Нет бронирований
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-zinc-500">
            <th className="px-4 py-3 font-medium">Дата</th>
            <th className="px-4 py-3 font-medium">Ресурс</th>
            <th className="px-4 py-3 font-medium">Время</th>
            <th className="px-4 py-3 font-medium">Модуль</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium text-right">Сумма</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50">
          {bookings.map((b) => (
            <tr key={b.id} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 text-zinc-900">
                {formatDate(b.date)}
              </td>
              <td className="px-4 py-3 text-zinc-600">{b.resourceName}</td>
              <td className="px-4 py-3 text-zinc-600">
                {formatTime(b.startTime)} – {formatTime(b.endTime)}
              </td>
              <td className="px-4 py-3">
                <span>
                  {MODULE_ICONS[b.moduleSlug]}{" "}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANT[b.status] || "default"}>
                  {BOOKING_STATUS_LABEL[b.status] || b.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right font-medium text-zinc-900">
                {b.amount > 0 ? formatRubles(b.amount) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTab({ orders }: { orders: ClientOrder[] }) {
  if (orders.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">Нет заказов</p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-zinc-500">
            <th className="px-4 py-3 font-medium">Дата</th>
            <th className="px-4 py-3 font-medium">Позиций</th>
            <th className="px-4 py-3 font-medium">Доставка</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium text-right">Сумма</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-50">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 text-zinc-900">
                {formatDate(o.createdAt)}
              </td>
              <td className="px-4 py-3 text-zinc-600">{o.itemCount}</td>
              <td className="px-4 py-3 text-zinc-600">
                {o.deliveryTo ? `Оф. ${o.deliveryTo}` : "—"}
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANT[o.status] || "default"}>
                  {ORDER_STATUS_LABEL[o.status] || o.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right font-medium text-zinc-900">
                {formatRubles(o.totalAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpendingTab({ months }: { months: MonthlySpending[] }) {
  if (months.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        Нет данных о тратах
      </p>
    );
  }

  const maxTotal = Math.max(...months.map((m) => m.total));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="space-y-3">
        {months.map((m) => (
          <div key={m.month} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-900">
                {formatMonth(m.month)}
              </span>
              <span className="font-semibold text-zinc-900">
                {formatRubles(m.total)}
              </span>
            </div>
            <div className="flex h-4 rounded-full bg-zinc-100 overflow-hidden">
              {m.bookingsSpent > 0 && (
                <div
                  className="bg-green-400 transition-all"
                  style={{
                    width: `${(m.bookingsSpent / maxTotal) * 100}%`,
                  }}
                  title={`Бронирования: ${formatRubles(m.bookingsSpent)}`}
                />
              )}
              {m.ordersSpent > 0 && (
                <div
                  className="bg-amber-400 transition-all"
                  style={{
                    width: `${(m.ordersSpent / maxTotal) * 100}%`,
                  }}
                  title={`Заказы: ${formatRubles(m.ordersSpent)}`}
                />
              )}
            </div>
            <div className="flex gap-4 text-xs text-zinc-400">
              {m.bookingsSpent > 0 && (
                <span>Бронирования: {formatRubles(m.bookingsSpent)}</span>
              )}
              {m.ordersSpent > 0 && (
                <span>Заказы: {formatRubles(m.ordersSpent)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
          Бронирования
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
          Заказы
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-zinc-900">{value}</p>
    </div>
  );
}
