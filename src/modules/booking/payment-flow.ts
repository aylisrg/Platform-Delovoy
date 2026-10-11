import type { BookingMetadata } from "./types";

/**
 * Знает ли персонал о брони.
 *
 * Бронь с сайта, по которой ссылка на оплату выдана сразу (`paymentFlow:
 * online`), доходит до смены только после оплаты — как «оплачена». Пока денег
 * нет, о ней никому из персонала не сообщалось, значит, и её отмена (клиентом,
 * менеджером или за неоплатой) — не новость: иначе в чате всплывала бы
 * «отмена» брони, которую никто не видел.
 *
 * Брони без флага — из бота/Mini App, по телефону, созданные до его появления —
 * персонал видел всегда, для них поведение не меняется.
 */
export function isHiddenFromStaff(metadata: unknown): boolean {
  const meta = (metadata as BookingMetadata | null) ?? {};
  return meta.paymentFlow === "online" && !(Number(meta.onlinePaidAmount ?? 0) > 0);
}
