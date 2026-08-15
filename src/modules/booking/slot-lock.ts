import { Prisma } from "@prisma/client";
import { log } from "@/lib/logger";

/**
 * Сериализация конкурентных операций над одним слотом расписания.
 *
 * ## Зачем
 *
 * Проверка занятости и запись брони — два разных запроса. Между ними есть окно,
 * в которое успевает влезть параллельный запрос: оба видят «свободно», оба пишут,
 * слот забронирован дважды. Классический TOCTOU, на популярном слоте после
 * перезапуска публичного бронирования он ловится руками.
 *
 * `pg_advisory_xact_lock` берёт эксклюзивную блокировку на произвольный ключ до
 * конца транзакции. Второй запрос с тем же ключом ждёт коммита первого и уже
 * видит его бронь в конфликт-чеке. Блокировка снимается автоматически при
 * commit и при rollback — забыть освободить её нельзя.
 *
 * ## Ключ
 *
 * Гранулярность — ресурс + день: две брони одной беседки на разные даты не
 * должны ждать друг друга, а на одну дату обязаны. `moduleSlug` в ключе, потому
 * что `resourceId` уникален в пределах модуля, а таблица `Booking` общая.
 *
 * `hashtext` сводит строку к int4, поэтому теоретически возможна коллизия ключей
 * у разных слотов. Последствие — лишняя сериализация двух несвязанных броней на
 * доли секунды, не ошибка. Обратная ситуация (два запроса на один слот получают
 * разные ключи) невозможна: одинаковая строка всегда даёт одинаковый хеш.
 *
 * ## Как применять
 *
 * Вызов обязан быть **первым** стейтментом транзакции, а конфликт-чек и запись —
 * в той же транзакции и на том же `tx`. Проверка через `prisma` вместо `tx`
 * оставляет ровно ту дыру, которую этот код закрывает.
 *
 * ```ts
 * await prisma.$transaction(async (tx) => {
 *   await lockSlot(tx, MODULE_SLUG, resourceId, bookingDate);
 *   const conflict = await tx.booking.findFirst({ ... });
 *   if (conflict) throw new BookingError("BOOKING_CONFLICT", "Это время уже занято");
 *   return tx.booking.create({ ... });
 * });
 * ```
 *
 * Внешние вызовы (платёжный провайдер, Telegram, почта) внутрь транзакции не
 * заводить: они держали бы блокировку слота всё время сетевого запроса.
 */
export async function lockSlot(
  tx: Prisma.TransactionClient,
  moduleSlug: string,
  resourceId: string,
  date: Date
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${slotLockKey(moduleSlug, resourceId, date)})::bigint)`
  );
}

/**
 * Ключ блокировки. Вынесен отдельно, чтобы его можно было проверить тестом:
 * от него зависит, встретятся ли два конкурента на одной блокировке.
 *
 * Дата приводится к календарному дню в UTC — `Booking.date` хранится как полночь
 * UTC, так что два запроса на один день дают одинаковый ключ.
 */
export function slotLockKey(moduleSlug: string, resourceId: string, date: Date): string {
  return `${moduleSlug}:${resourceId}:${date.toISOString().slice(0, 10)}`;
}

/**
 * DB-backstop против двойного бронирования (issue #548): EXCLUDE-констрейнт
 * `booking_no_overlap` на активных статусах. Под корректным кодом
 * недостижим — `lockSlot()` всегда идёт первым стейтментом той же
 * транзакции, что конфликт-чек и запись, так что обычная гонка ловится
 * `findFirst()` выше по коду, а не этим констрейнтом. Срабатывание значит,
 * что что-то обошло `lockSlot()` — регрессия в коде или прямая запись в БД
 * мимо приложения. Каждый вызывающий route.ts ловит ошибки в общий
 * `catch → apiServerError()` без логирования, поэтому без явного лога
 * здесь срабатывание останется незамеченным.
 *
 * У EXCLUDE-нарушения нет типизированного `Prisma.PrismaClientKnownRequestError`
 * кода (в отличие от P2002 у обычных unique-констрейнтов) — Postgres код
 * 23P01 виден только в тексте ошибки, поэтому матчим по имени констрейнта.
 */
export async function handleOverlapBackstop(
  error: unknown,
  moduleSlug: string,
  resourceId: string
): Promise<boolean> {
  const isBackstop =
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    error.message.includes("booking_no_overlap");
  if (isBackstop) {
    await log.error(
      "booking",
      "EXCLUDE-констрейнт booking_no_overlap сработал — advisory-lock не предотвратил конфликт (обход блокировки?)",
      { moduleSlug, resourceId }
    );
  }
  return isBackstop;
}
