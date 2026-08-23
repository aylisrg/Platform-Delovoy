import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Редакции публикуемых юридических документов и доказательственный слой
 * акцепта.
 *
 * Живёт в `booking`, а не в отдельном модуле: акцепт оферты — часть договора
 * на бронирование, а не самостоятельная бизнес-область (Scope guard #1).
 */

/** Ключи документов. Оферта Плей Парка добавится сюда, когда появится текст. */
export const DOCUMENT_KEYS = {
  gazebosOffer: "gazebos-offer",
  privacyPolicy: "privacy-policy",
} as const;

export type DocumentKey = (typeof DOCUMENT_KEYS)[keyof typeof DOCUMENT_KEYS];

export class OfferError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OfferError";
  }
}

/**
 * SHA-256 от текста редакции.
 *
 * Считается один раз при публикации и копируется в бронь при акцепте: ссылки
 * на номер редакции недостаточно, хеш доказывает, что показанный клиенту текст
 * не был изменён задним числом (ТЗ §6.2).
 *
 * Переводы строк нормализуются — иначе один и тот же текст, вычитанный на
 * Windows, дал бы другой хеш и «расхождение» на ровном месте.
 */
export function hashDocumentBody(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

export type OfferVersionRef = {
  id: string;
  documentKey: string;
  number: number;
  slug: string;
  title: string;
  body: string;
  contentHash: string;
  publishedAt: Date;
  effectiveAt: Date;
  isCurrent: boolean;
};

/** Действующая редакция документа. `null` — документ ещё не опубликован. */
export async function getCurrentVersion(documentKey: DocumentKey): Promise<OfferVersionRef | null> {
  return prisma.offerVersion.findFirst({
    where: { documentKey, isCurrent: true },
    orderBy: { number: "desc" },
  });
}

/** Конкретная редакция из архива. */
export async function getVersionBySlug(
  documentKey: DocumentKey,
  slug: string
): Promise<OfferVersionRef | null> {
  return prisma.offerVersion.findFirst({ where: { documentKey, slug } });
}

/** Все редакции документа, новые сверху — для страницы архива. */
export async function listVersions(documentKey: DocumentKey) {
  return prisma.offerVersion.findMany({
    where: { documentKey },
    orderBy: { number: "desc" },
    select: {
      id: true,
      number: true,
      slug: true,
      title: true,
      publishedAt: true,
      effectiveAt: true,
      isCurrent: true,
    },
  });
}

export type AcceptanceInput = {
  /** Slug редакции, которую клиент видел в момент нажатия «Оплатить». */
  offerVersionSlug: string;
  acceptMarketing: boolean;
  ip: string | null;
  userAgent: string | null;
};

export type AcceptanceRecord = {
  offerVersionId: string;
  offerContentHash: string;
  acceptedOfferAt: Date;
  acceptedMarketing: boolean;
  acceptedIp: string | null;
  acceptedUserAgent: string | null;
};

/**
 * Собирает поля акцепта для записи в бронь.
 *
 * Slug из тела запроса сверяется с действующей редакцией: если пока клиент
 * читал документ, вышла новая редакция, договор нельзя заключить на условиях,
 * которых больше нет — просим обновить страницу. Молча подставить актуальную
 * редакцию нельзя: клиент её не видел.
 */
export async function buildAcceptance(
  documentKey: DocumentKey,
  input: AcceptanceInput
): Promise<AcceptanceRecord> {
  const current = await getCurrentVersion(documentKey);
  if (!current) {
    throw new OfferError(
      "OFFER_NOT_PUBLISHED",
      "Условия оказания услуг сейчас недоступны. Пожалуйста, свяжитесь с нами по телефону."
    );
  }
  if (current.slug !== input.offerVersionSlug) {
    throw new OfferError(
      "OFFER_VERSION_STALE",
      "Условия оферты обновились. Обновите страницу и оформите бронирование заново."
    );
  }

  return {
    offerVersionId: current.id,
    offerContentHash: current.contentHash,
    acceptedOfferAt: new Date(),
    acceptedMarketing: input.acceptMarketing,
    acceptedIp: input.ip,
    acceptedUserAgent: truncateUserAgent(input.userAgent),
  };
}

/** User-Agent бывает многословным; для доказательства хватает разумной длины. */
function truncateUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 512);
}

// === Токен страницы управления бронью (ТЗ §8) ===

/**
 * Токен выводится из id брони и серверного секрета (HMAC-SHA256), а не
 * генерируется случайно.
 *
 * Почему так. Ссылка нужна в двух разных запросах: сразу при создании брони
 * (бот и Mini App отдают её пользователю) и позже, в вебхуке об оплате, где
 * формируется письмо-подтверждение. Случайный токен во втором месте пришлось
 * бы либо хранить в открытом виде — тогда дамп БД даёт доступ ко всем броням,
 * — либо перевыпускать, и выданная раньше ссылка молча умирала бы.
 *
 * Свойства при выводе через HMAC сохраняются: без секрета токен не подобрать,
 * по номеру брони он невосстановим (ТЗ §8), а в БД по-прежнему лежит только
 * SHA-256 — он нужен для обратного поиска брони по токену.
 */
function manageSecret(): string | null {
  return (
    process.env.BOOKING_MANAGE_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    null
  );
}

/**
 * Токен управления бронью. Один и тот же для одной брони, пока жив секрет.
 *
 * `null` — секрет не настроен. Возвращаем null, а не бросаем: самообслуживание
 * это удобство поверх брони, и отсутствие его секрета не повод отказывать
 * клиенту в бронировании. Вызывающий код должен деградировать, а не падать.
 */
export function manageTokenFor(bookingId: string): string | null {
  const secret = manageSecret();
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`booking-manage:${bookingId}`, "utf8")
    .digest("base64url");
}

/** Токен и его хеш для записи в бронь; `null` — секрет не настроен. */
export function createManageToken(
  bookingId: string
): { token: string; hash: string } | null {
  const token = manageTokenFor(bookingId);
  if (!token) return null;
  return { token, hash: hashManageToken(token) };
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Сравнение хешей за постоянное время — токен это секрет. */
export function manageTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashManageToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Человекочитаемый номер брони. Как `orderNumber` в кафе — производный от id. */
export function bookingNumber(bookingId: string): string {
  return `БП-${bookingId.slice(-6).toUpperCase()}`;
}
