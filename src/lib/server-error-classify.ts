/**
 * Классификация исключений, которые Next.js отдаёт в хук `onRequestError`
 * (issue #717, зонтик server-error).
 *
 * Часть «500-х» фреймворка рождает не наш код, а сам запрос: сканеры и боты
 * шлют POST на публичные страницы с мусорным `Next-Router-State-Tree`, а
 * клиент с вкладкой, открытой до деплоя, зовёт Server Action, которого в новой
 * сборке уже нет. Next.js честно отвечает 500 и зовёт хук — но чинить тут
 * нечего: паттерны #701/#702 (RSC invariant, router state header) две недели
 * ходили по интейку как ERROR и заводили issues на пустом месте, а «Failed to
 * find Server Action» пачками лежит в прод-логах каждого разбора site-watchdog
 * (#694/#711/#735).
 *
 * Такие ошибки уходят в SystemEvent как WARNING (видно на дашборде, всплеск
 * поймает спайк-детектор), а не ERROR (Telegram админам + issue от
 * `analyze-errors.ts`). Список — только задокументированные тексты Next.js;
 * всё неизвестное остаётся ERROR, как и было.
 */
const CLIENT_INDUCED_FRAMEWORK_ERRORS: readonly RegExp[] = [
  // POST с испорченным заголовком Next-Router-State-Tree (боты/сканеры).
  /The router state header was sent but could not be parsed/i,
  // Клиент ждал RSC-ответ, а получил обычный — как правило, мусорный RSC-запрос.
  /Invariant: Expected RSC response, got /i,
  // Server Action из предыдущего деплоя (вкладка открыта до выката) — в
  // прод-логах инцидентов #694/#711/#735 по 3–10 строк за минуту (пункт
  // `failed-server-action-stale-deploy` зонтика #717).
  /Failed to find Server Action/i,
];

/** true — ошибка вызвана самим запросом (устаревший клиент, бот), а не багом приложения. */
export function isClientInducedFrameworkError(message: string): boolean {
  return CLIENT_INDUCED_FRAMEWORK_ERRORS.some((re) => re.test(message));
}
