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
}

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
    const cycles = closed.filter((i) => {
      if (!i.labels.includes(label)) return false;
      if (!i.closedAt) return false;
      const t = new Date(i.closedAt).getTime();
      return !Number.isNaN(t) && t >= cutoffMs && t <= now.getTime();
    });
    if (cycles.length >= opts.minCycles) {
      result.push({
        label,
        count: cycles.length,
        issues: cycles.map((i) => i.number).sort((a, b) => a - b),
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
  return {
    title: `Root cause: ${incident.label} — ${incident.count} цикла(ов) за ${opts.windowDays} дней`,
    labels: ['root-cause', incident.label, 'prio:P1', 'auto:ready'],
    body: `## Повторяющийся инцидент \`${incident.label}\`

За последние ${opts.windowDays} дней инцидент открывался и закрывался ${incident.count} раз(а):

${cycleList}

Watchdog каждый раз восстанавливает сервис, но корневую причину никто не чинит.
Задача: разобрать логи ремедиаций из перечисленных инцидент-issues, найти общую
причину и устранить её (или, если причина внешняя и неустранимая, — задокументировать
и настроить деградацию мягче).

---
*Создано автоматически: \`scripts/escalate-incidents.ts\` (workflow \`backlog-intake.yml\`).*`,
  };
}
