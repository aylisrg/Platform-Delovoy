import { ADMIN_HINTS } from "@/lib/admin-hints";

/**
 * Контент еженедельных подсказок бота (ADR 2026-11-09-staff-booking-reports-digest).
 *
 * Уровни доступа — по аудитории подсказки, а не по тексту:
 * - `CLIENT_TIPS` — только публичные возможности; их видит каждый, в т.ч. USER.
 *   Здесь нет ссылок на /admin и нет внутренних деталей.
 * - `STAFF_APP_TIPS` — любому сотруднику (MANAGER/ADMIN/SUPERADMIN).
 * - подсказки разделов — из `ADMIN_HINTS`, ТОЛЬКО по разделам, которые человеку
 *   выдаёт `computeAdminSections` (тот же источник, что гейт админки).
 *
 * Leaf-модуль без БД — тексты проверяются тестами.
 */

export type Tip = { title: string; text: string };
export type SectionTip = Tip & { section: string; sectionTitle: string };

export const CLIENT_TIPS: Tip[] = [
  {
    title: "Беседка в пару касаний",
    text: "Забронируйте беседку Барбекю Парка прямо в Mini App: выберите дату и время, оплатите онлайн — бронь подтвердится сразу.",
  },
  {
    title: "Плей Парк без звонка",
    text: "Стол PlayStation можно забронировать в Mini App в разделе «Плей Парк» — время и стоимость видны до оплаты.",
  },
  {
    title: "Кафе с доставкой в офис",
    text: "Закажите из меню кафе в Mini App и укажите номер офиса — заказ принесут. Статус заказа придёт сообщением.",
  },
  {
    title: "Все брони в одном месте",
    text: "Во вкладке «Мои брони» видны все ваши брони: время, статус и страница брони с условиями.",
  },
  {
    title: "Напоминание придёт само",
    text: "За час до начала брони бот пришлёт напоминание — ничего настраивать не нужно.",
  },
  {
    title: "Сами решаете, о чём писать",
    text: "В Mini App: «Профиль» → «Уведомления и каналы» — там выключаются сообщения о бронях, заказах, напоминания и эти подсказки.",
  },
];

export const STAFF_APP_TIPS: Tip[] = [
  {
    title: "Брони — лично вам",
    text: "Новые брони, брони по телефону, переносы и отмены по вашим разделам приходят личным сообщением. Лишнее выключите в Mini App: «Профиль» → «Центр уведомлений».",
  },
  {
    title: "Пропустили сообщение?",
    text: "Все личные уведомления остаются в ленте Mini App — бронь можно открыть оттуда.",
  },
  {
    title: "Почему не пришло",
    text: "Если бот заблокирован или не запущен, сообщения не доходят. Статус и причины видны в Центре уведомлений Mini App.",
  },
];

/** Section hints the person may see: only sections they actually have. */
export function sectionTips(sections: readonly string[]): SectionTip[] {
  const allowed = new Set(sections);
  return Object.entries(ADMIN_HINTS)
    .filter(([section]) => allowed.has(section))
    .flatMap(([section, group]) =>
      group.hints.map((hint) => ({ ...hint, section, sectionTitle: group.sectionTitle })),
    );
}
