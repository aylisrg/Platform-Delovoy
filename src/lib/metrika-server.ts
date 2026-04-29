/**
 * Server-side трекинг конверсий в Яндекс.Метрику через Offline Conversions API.
 *
 * Проблема: клиентский reachGoal() блокируется AdBlock/ITP — за 30 дней мы зафиксировали
 * 1 office_inquiry_submit при 126 платных визитах. Решение — дублировать события с сервера
 * на основании cookie `_ym_uid` (ставит сам счётчик Метрики).
 *
 * Документация:
 * https://yandex.ru/dev/metrika/doc/api2/practice/offline-conversion.html
 *
 * Важные особенности:
 * - Запрос НЕ блокирует ответ API клиенту (используем `void promise.catch(...)`).
 * - Если cookie `_ym_uid` нет — у юзера счётчик заблокирован, тихо логируем и выходим.
 * - Если нет YANDEX_OAUTH_TOKEN или YANDEX_METRIKA_COUNTER_ID — это dev/test, выходим без шума.
 * - Ошибки HTTP не падают — Метрика недоступна, но бизнес-операция уже прошла.
 */
import type { NextRequest } from "next/server";
import { log } from "@/lib/logger";

/** Идентификаторы целей, которые могут трекаться с сервера. */
export type ServerGoal =
  | "gazebo_booking_success"
  | "pspark_booking_success"
  | "office_inquiry_success";

export interface TrackServerGoalInput {
  request: NextRequest;
  target: ServerGoal;
  /** Сумма конверсии (для бронирований — итоговая стоимость, для заявок — null). */
  price?: number | null;
  /** ISO 4217. По умолчанию RUB. */
  currency?: string;
  /** Время события (Unix seconds). По умолчанию — now. */
  dateTimeSeconds?: number;
}

const API_HOST = "https://api-metrika.yandex.net";

/**
 * Извлекает _ym_uid из NextRequest cookies.
 * Метрика ставит этот cookie сама на стороне браузера; формат — числовой 19-значный.
 */
export function extractYmUid(request: NextRequest): string | null {
  const raw = request.cookies.get("_ym_uid")?.value;
  if (!raw) return null;
  const trimmed = raw.trim();
  // Защита от мусора в cookie — берём только цифровой ClientId.
  if (!/^\d{6,32}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Формирует CSV для Offline Conversions API.
 * Header обязателен по спецификации.
 */
export function buildOfflineConversionsCsv(rows: {
  clientId: string;
  target: string;
  dateTimeSeconds: number;
  price: number;
  currency: string;
}[]): string {
  const header = "ClientId,Target,DateTime,Price,Currency";
  const body = rows
    .map((r) => `${r.clientId},${r.target},${r.dateTimeSeconds},${r.price},${r.currency}`)
    .join("\n");
  return `${header}\n${body}\n`;
}

/**
 * Низкоуровневая отправка CSV. Экспортируется для тестов; в продакшне используй trackServerGoal.
 */
export async function uploadOfflineConversions(params: {
  counterId: string;
  oauthToken: string;
  csv: string;
}): Promise<void> {
  const { counterId, oauthToken, csv } = params;
  const url = `${API_HOST}/management/v1/counter/${counterId}/offline_conversions/upload?client_id_type=CLIENT_ID`;

  // multipart/form-data с файлом `file`. У глобального FormData (web-стандарт в Node 20+)
  // Blob поддерживается из коробки.
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "conversions.csv");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${oauthToken}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    // Не бросаем — caller обернёт в catch и зальёт в SystemEvent. Но даём caller'у узнать про ошибку.
    throw new Error(`Metrika upload failed: ${res.status} ${text.slice(0, 500)}`);
  }
}

/**
 * Главная точка входа: трекает one-shot конверсию.
 *
 * НЕ ждёт завершения сетевого запроса — возвращается сразу. Потеря трекинга при
 * холодном старте serverless-инстанса считается приемлемой: альтернатива — задержка
 * ответа клиенту на 200–500 мс ради аналитики. Бизнес важнее.
 */
export function trackServerGoal(input: TrackServerGoalInput): void {
  // Читаем env при каждом вызове — иначе тесты не могут симулировать "нет токена",
  // а в проде один процесс может пережить ротацию переменных через redeploy.
  const counterId = process.env.YANDEX_METRIKA_COUNTER_ID;
  const oauthToken = process.env.YANDEX_OAUTH_TOKEN;

  // Тестовая среда / нет конфига — молча выходим.
  if (!counterId || !oauthToken) {
    return;
  }

  const clientId = extractYmUid(input.request);
  if (!clientId) {
    // У части юзеров счётчик заблокирован — это норма, не ошибка.
    void log.info("metrika", "no _ym_uid cookie — skip server goal", {
      target: input.target,
    });
    return;
  }

  const dateTimeSeconds =
    input.dateTimeSeconds ?? Math.floor(Date.now() / 1000);
  const price = input.price ?? 0;
  const currency = input.currency ?? "RUB";

  const csv = buildOfflineConversionsCsv([
    {
      clientId,
      target: input.target,
      dateTimeSeconds,
      price,
      currency,
    },
  ]);

  // Fire-and-forget. Любой сбой Метрики не должен ломать API-ответ клиенту.
  void uploadOfflineConversions({
    counterId,
    oauthToken,
    csv,
  }).catch((err) => {
    void log.warn("metrika", "server goal upload failed", {
      target: input.target,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
