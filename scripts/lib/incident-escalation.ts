/**
 * Эскалация повторяющихся инцидентов — чистая логика.
 *
 * Watchdog-issues (site-down, notifications-down, ci-failure) живут своим
 * циклом: открылась при падении, закрылась при восстановлении, — и в очередь
 * не попадают, это правильно для живого инцидента. Но если один и тот же
 * инцидент открывается и закрывается несколько раз за неделю, значит, у него
 * есть корневая причина, которую никто не чинит. Тогда заводится одна durable
 * root-cause issue с prio:P1 + auto:ready — её берёт обычный цикл очереди.
 */

export interface ClosedIssueLite {
  number: number;
  labels: string[];
  closedAt: string | null;
  /** Тело инцидент-issue — по нему отличаем флап внешней пробы от падения сервиса. */
  body?: string | null;
}

/**
 * Маркер, который site-watchdog ставит в тело инцидента, когда с VPS сайт
 * отвечал и ремедиация ничего не делала: до сервера не достучалась только
 * внешняя проба (GitHub-раннер → RU VPS). Такие циклы — не «сервис упал и
 * поднялся», их корневая причина вне репозитория (#736: три цикла site-down за
 * неделю, все три — `Public health OK — nothing to fix`), и в эскалацию
 * root-cause они не считаются. Сам инцидент и Telegram-алерт при этом остаются.
 */
export const PROBE_FLAP_MARKER = '<!-- watchdog:probe-flap -->';

export function isProbeFlap(body: string | null | undefined): boolean {
  if (!body) return false;
  if (body.includes(PROBE_FLAP_MARKER)) return true;
  // Инциденты, заведённые до появления маркера: тот же признак читаем из
  // вложенного отчёта ремедиации.
  return body.includes('WATCHDOG_RESULT=healthy') && body.includes('nothing to fix');
}

export interface EscalationOptions {
  windowDays: number;
  minCycles: number;
}

export const DEFAULT_ESCALATION_OPTIONS: EscalationOptions = {
  windowDays: 7,
  minCycles: 3,
};

export interface RecurringIncident {
  label: string;
  count: number;
  issues: number[];
  /** Циклы-флапы внешней пробы за то же окно — в `count` не входят, показываем для контекста. */
  flaps?: number[];
}

/** Лейбл, которым помечена сама root-cause issue (не живой инцидент). */
export const ROOT_CAUSE_LABEL = 'root-cause';

/**
 * Какие инцидент-лейблы зациклились: >= minCycles закрытий за окно.
 * На вход — закрытые issues одного лейбла или свалкой; фильтрует сам.
 */
export function recurringIncidents(
  incidentLabels: readonly string[],
  closed: ClosedIssueLite[],
  now: Date,
  opts: EscalationOptions = DEFAULT_ESCALATION_OPTIONS,
): RecurringIncident[] {
  const cutoffMs = now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000;
  const result: RecurringIncident[] = [];

  for (const label of incidentLabels) {
    const inWindow = closed.filter((i) => {
      if (!i.labels.includes(label)) return false;
      // root-cause issue несёт тот же инцидент-лейбл, что и живые инциденты,
      // которые она описывает. Без этого исключения её собственное закрытие
      // (авто-закрытие при восстановлении CI до ADR 2026-08-20, или ручное
      // после фикса) засчитывалось как ещё один цикл инцидента — эскалация
      // считала сама себя и не останавливалась, даже когда новых падений не было
      // (issue #698: 3→4→5 «циклов» подряд без единого нового CI-инцидента).
      if (i.labels.includes(ROOT_CAUSE_LABEL)) return false;
      if (!i.closedAt) return false;
      const t = new Date(i.closedAt).getTime();
      return !Number.isNaN(t) && t >= cutoffMs && t <= now.getTime();
    });
    const cycles = inWindow.filter((i) => !isProbeFlap(i.body));
    const flaps = inWindow.filter((i) => isProbeFlap(i.body));
    if (cycles.length >= opts.minCycles) {
      result.push({
        label,
        count: cycles.length,
        issues: cycles.map((i) => i.number).sort((a, b) => a - b),
        flaps: flaps.map((i) => i.number).sort((a, b) => a - b),
      });
    }
  }
  return result;
}

export function rootCauseIssue(
  incident: RecurringIncident,
  opts: EscalationOptions = DEFAULT_ESCALATION_OPTIONS,
): { title: string; body: string; labels: string[] } {
  const cycleList = incident.issues.map((n) => `- #${n}`).join('\n');
  const flaps = incident.flaps ?? [];
  const flapsNote = flaps.length
    ? `\nЕщё ${flaps.length} цикл(ов) за окно — флапы внешней пробы (с VPS сайт отвечал, ремедиация ничего не делала): ${flaps.map((n) => `#${n}`).join(', ')}. В счёт не входят.\n`
    : '';
  return {
    title: `Root cause: ${incident.label} — ${incident.count} цикла(ов) за ${opts.windowDays} дней`,
    labels: [ROOT_CAUSE_LABEL, incident.label, 'prio:P1', 'auto:ready'],
    body: `## Повторяющийся инцидент \`${incident.label}\`

За последние ${opts.windowDays} дней инцидент открывался и закрывался ${incident.count} раз(а):

${cycleList}
${flapsNote}
Watchdog каждый раз восстанавливает сервис, но корневую причину никто не чинит.
Задача: разобрать логи ремедиаций из перечисленных инцидент-issues, найти общую
причину и устранить её (или, если причина внешняя и неустранимая, — задокументировать
и настроить деградацию мягче).

---
*Создано автоматически: \`scripts/escalate-incidents.ts\` (workflow \`backlog-intake.yml\`).*`,
  };
}
