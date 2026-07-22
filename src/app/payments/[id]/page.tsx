"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type PublicStatus = {
  id: string;
  status:
    | "PENDING"
    | "WAITING_FOR_CAPTURE"
    | "SUCCEEDED"
    | "CANCELED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";
  confirmationUrl: string | null;
  moduleSlug: string;
  order: {
    orderNumber: string;
    deliveryTo: string | null;
    items: { name: string; quantity: number }[];
  } | null;
};

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MINUTES = 15;

/**
 * Страница ожидания оплаты. return_url ЮKassa ведёт сюда; редирект гостя
 * обратно НЕ означает успешную оплату — страница поллит наш API (который
 * при нефинальном статусе сверяется с провайдером) до финального статуса.
 *
 * Для заказов кафе (moduleSlug=cafe) финальные экраны свои: крупный номер
 * заказа для бариста вместо текстов о бронированиях.
 */
export default function PaymentWaitPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<PublicStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/${params.id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const json = await res.json();
      if (json.success) setState(json.data);
    } catch {
      // сеть мигнула — следующий тик попробует снова
    }
  }, [params.id]);

  useEffect(() => {
    if (startedAt.current === null) startedAt.current = Date.now();
    poll();
    const timer = setInterval(() => {
      if (Date.now() - (startedAt.current ?? 0) > MAX_POLL_MINUTES * 60_000) {
        setTimedOut(true);
        clearInterval(timer);
        return;
      }
      poll();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const isFinal =
    state &&
    (state.status === "SUCCEEDED" ||
      state.status === "CANCELED" ||
      state.status === "REFUNDED" ||
      state.status === "PARTIALLY_REFUNDED");

  const isCafe = state?.moduleSlug === "cafe";

  // Заказ оплачен — корзина кафе в localStorage больше не нужна. При отменённой
  // оплате ключ намеренно остаётся: клиент вернётся в меню к собранной корзине.
  useEffect(() => {
    if (isCafe && state?.status === "SUCCEEDED") {
      try {
        localStorage.removeItem("cafe-cart-v1");
      } catch {
        // приватный режим — некритично
      }
    }
  }, [isCafe, state?.status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      {notFound ? (
        <>
          <div className="text-5xl">🤔</div>
          <h1 className="mt-4 text-xl font-semibold">Платёж не найден</h1>
          <p className="mt-2 text-sm text-gray-500">
            Проверьте ссылку или обратитесь к администратору.
          </p>
        </>
      ) : !state || (!isFinal && !timedOut) ? (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <h1 className="mt-6 text-xl font-semibold">Ожидаем подтверждение оплаты…</h1>
          <p className="mt-2 text-sm text-gray-500">
            Обычно это занимает несколько секунд. Страницу можно не обновлять.
          </p>
          {state?.status === "PENDING" && state.confirmationUrl && (
            <a
              href={state.confirmationUrl}
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Открыть страницу оплаты
            </a>
          )}
        </>
      ) : state.status === "SUCCEEDED" ? (
        isCafe ? (
          <>
            <div className="text-5xl">✅</div>
            <h1 className="mt-4 text-xl font-semibold">Оплачено!</h1>
            {state.order && (
              <>
                <p className="mt-6 text-sm uppercase tracking-wide text-gray-400">
                  Номер заказа
                </p>
                <p className="mt-1 text-6xl font-bold tracking-widest text-emerald-600">
                  {state.order.orderNumber}
                </p>
                {state.order.items.length > 0 && (
                  <ul className="mt-6 w-full rounded-xl bg-gray-50 px-4 py-3 text-left text-sm text-gray-700">
                    {state.order.items.map((item, idx) => (
                      <li key={idx} className="flex justify-between py-1">
                        <span>{item.name}</span>
                        <span className="text-gray-400">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-sm text-gray-500">
                  {state.order.deliveryTo
                    ? `Принесём в офис ${state.order.deliveryTo}.`
                    : "Покажите этот экран бариста, если попросят."}
                </p>
              </>
            )}
            <p className="mt-2 text-xs text-gray-400">
              Чек придёт на указанный при оплате контакт.
            </p>
            <Link
              href="/cafe"
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Вернуться в меню
            </Link>
          </>
        ) : (
          <>
            <div className="text-5xl">✅</div>
            <h1 className="mt-4 text-xl font-semibold">Оплата прошла успешно!</h1>
            <p className="mt-2 text-sm text-gray-500">
              Бронирование подтверждено. Чек придёт на указанный контакт, подробности — в
              уведомлении.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Мои бронирования
            </Link>
          </>
        )
      ) : state.status === "CANCELED" ? (
        isCafe ? (
          <>
            <div className="text-5xl">😔</div>
            <h1 className="mt-4 text-xl font-semibold">Оплата не прошла</h1>
            <p className="mt-2 text-sm text-gray-500">
              Заказ отменён, деньги не списаны. Корзина сохранилась — попробуйте ещё раз.
            </p>
            <Link
              href="/cafe"
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Вернуться в меню
            </Link>
          </>
        ) : (
          <>
            <div className="text-5xl">😔</div>
            <h1 className="mt-4 text-xl font-semibold">Оплата не прошла</h1>
            <p className="mt-2 text-sm text-gray-500">
              Бронирование не подтверждено — слот освобождён. Попробуйте забронировать ещё раз.
            </p>
            <Link
              href="/gazebos"
              className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              К бронированию
            </Link>
          </>
        )
      ) : timedOut && !isFinal ? (
        <>
          <div className="text-5xl">⏳</div>
          <h1 className="mt-4 text-xl font-semibold">Платёж ещё обрабатывается</h1>
          <p className="mt-2 text-sm text-gray-500">
            {isCafe
              ? "Как только банк подтвердит оплату, заказ оформится автоматически."
              : "Как только банк подтвердит оплату, бронирование подтвердится автоматически, а вам придёт уведомление."}
          </p>
        </>
      ) : (
        <>
          <div className="text-5xl">↩️</div>
          <h1 className="mt-4 text-xl font-semibold">По платежу оформлен возврат</h1>
          <p className="mt-2 text-sm text-gray-500">
            Деньги вернутся тем же способом, которым вы платили (обычно 1–3 дня).
          </p>
        </>
      )}
    </main>
  );
}
