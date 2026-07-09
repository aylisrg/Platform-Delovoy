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
};

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MINUTES = 15;

/**
 * Страница ожидания оплаты. return_url ЮKassa ведёт сюда; редирект гостя
 * обратно НЕ означает успешную оплату — страница поллит наш API (который
 * при нефинальном статусе сверяется с провайдером) до финального статуса.
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
      ) : state.status === "CANCELED" ? (
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
      ) : timedOut && !isFinal ? (
        <>
          <div className="text-5xl">⏳</div>
          <h1 className="mt-4 text-xl font-semibold">Платёж ещё обрабатывается</h1>
          <p className="mt-2 text-sm text-gray-500">
            Как только банк подтвердит оплату, бронирование подтвердится автоматически, а вам
            придёт уведомление.
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
