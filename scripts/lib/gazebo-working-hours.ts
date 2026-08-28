/**
 * Приведение часов работы беседок к оферте.
 *
 * Режим работы Барбекю Парка зафиксирован договором: «ежедневно с 11:00 до
 * 22:30» (п. 3.4 оферты и Приложение № 1, `content/legal/gazebos-offer/v1.md`).
 * Слоты часовые, поэтому последний начинается в 21:00 и закрывается в 22:00 —
 * закрывающие полчаса по п. 6.9 уходят на уборку и выезд. Ровно эти значения
 * стоят дефолтами в `src/modules/gazebos/service.ts`.
 *
 * В проде же `Module.config` содержал 08:00–23:00: `config` для gazebos никем
 * не сидируется, значит окно попало туда через форму настроек и перекрыло
 * дефолты. Расхождение существовало и до появления опции «весь день», но именно
 * она сделала его дорогим — кнопка предлагала 15 часов, а потолок дневного
 * тарифа схлопывал их в цену дня, назначенную прайсом за 11:00–22:30.
 */

/** Часы работы по оферте (closeHour = 22, см. комментарий выше). */
export const OFFER_OPEN_HOUR = 11;
export const OFFER_CLOSE_HOUR = 22;

/** Расхождение, которое чиним: окно, уехавшее из формы настроек. */
export const DRIFTED_OPEN_HOUR = 8;
export const DRIFTED_CLOSE_HOUR = 23;

/**
 * Новый `Module.config` или `null`, если трогать нечего.
 *
 * Чиним ТОЛЬКО известное расхождение 08–23. Любое другое значение — осознанный
 * выбор администратора и переживает деплой; отсутствие ключей тоже не трогаем,
 * там и так действуют дефолты из кода. Иначе скрипт, живущий в шаге деплоя,
 * молча откатывал бы правки из админки, а поля в форме настроек превратились
 * бы в контрол, который не держится.
 */
export function fixDriftedWorkingHours(
  config: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const existing = config ?? {};
  const drifted =
    existing.openHour === DRIFTED_OPEN_HOUR &&
    existing.closeHour === DRIFTED_CLOSE_HOUR;
  if (!drifted) return null;

  return {
    ...existing,
    openHour: OFFER_OPEN_HOUR,
    closeHour: OFFER_CLOSE_HOUR,
  };
}

/** Человекочитаемое окно для лога: `08:00–23:00`, либо «не задано». */
export function describeWorkingHours(
  config: Record<string, unknown> | null | undefined
): string {
  const existing = config ?? {};
  const { openHour, closeHour } = existing;
  if (typeof openHour !== "number" || typeof closeHour !== "number") {
    return "не задано (действуют дефолты из кода)";
  }
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${pad(openHour)}–${pad(closeHour)}`;
}
