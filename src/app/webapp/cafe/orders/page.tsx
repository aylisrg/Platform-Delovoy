"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { Badge, Card, EmptyState, Skeleton } from "@/components/webapp/ui";
import { formatDateTime } from "@/lib/format";

/**
 * «Мои заказы» кафе (ADR §3.2): читает `GET /api/webapp/cafe/orders`, который
 * отдаёт только заказы вызывающего и не содержит связанного пользователя.
 */

interface WebappOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  paidAt: string | null;
  createdAt: string;
  items: Array<{ name: string; quantity: number; price: number }>;
}

type BadgeTone = "accent" | "success" | "warning" | "destructive" | "neutral";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Принят",
  PREPARING: "Готовится",
  READY: "Готов",
  DELIVERED: "Выдан",
  CANCELLED: "Отменён",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  NEW: "accent",
  PREPARING: "warning",
  READY: "success",
  DELIVERED: "neutral",
  CANCELLED: "destructive",
};

function formatPrice(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

export default function CafeOrdersPage() {
  const { ready, user, apiFetch, showBackButton, onBackButtonClick } = useTelegram();
  const [orders, setOrders] = useState<WebappOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  const loadOrders = useCallback(async () => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ orders: WebappOrder[] }>(
        "/api/webapp/cafe/orders"
      );
      setOrders(data.orders);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [ready, user, apiFetch]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[24px] font-bold">Мои заказы</h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--tg-hint)" }}>
          Заказы кафе «Деловой»
        </p>
      </div>

      {loading ? (
        <div className="px-4 mt-2 space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : ready && !user ? (
        <EmptyState
          icon="user"
          title="Нужен вход через Telegram"
          hint="Откройте кафе из бота — заказы привязаны к вашему аккаунту."
        />
      ) : failed ? (
        <EmptyState
          icon="alert"
          title="Не удалось загрузить заказы"
          hint="Проверьте связь и попробуйте ещё раз."
          action={
            <Link href="/webapp/cafe" className="tg-button">
              В меню кафе
            </Link>
          }
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="Заказов пока нет"
          hint="Соберите заказ в меню — он появится здесь сразу после оформления."
          action={
            <Link href="/webapp/cafe" className="tg-button">
              В меню кафе
            </Link>
          }
        />
      ) : (
        <div className="px-4 mt-2 space-y-3 pb-4">
          {orders.map((order) => (
            <Card key={order.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold tracking-wide">
                    {order.orderNumber}
                  </p>
                  <p
                    className="text-[13px] mt-0.5"
                    style={{ color: "var(--tg-hint)" }}
                  >
                    {formatDateTime(order.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </Badge>
                  {order.paidAt && <Badge tone="success">Оплачен онлайн</Badge>}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {order.items.map((item, index) => (
                  <div
                    key={`${order.id}-${index}`}
                    className="flex items-baseline justify-between gap-3 text-[14px]"
                  >
                    <span className="min-w-0 truncate">
                      {item.name}
                      <span style={{ color: "var(--tg-hint)" }}>
                        {" "}
                        × {item.quantity}
                      </span>
                    </span>
                    <span
                      className="shrink-0"
                      style={{ color: "var(--tg-subtitle)" }}
                    >
                      {formatPrice(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div
                className="mt-3 pt-3 flex items-center justify-between text-[16px] font-semibold"
                style={{ borderTop: "0.5px solid var(--tg-separator)" }}
              >
                <span>Итого</span>
                <span>{formatPrice(order.totalAmount)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
