import Link from "next/link";
import type { ReactNode } from "react";
import type { NotificationStats, UserNotificationStats } from "@/modules/notifications/types";
import { formatCount, plural } from "./format";

/**
 * «Проблемы» (AC-D4.1 / AC-D4.2): where delivery breaks, with links to the
 * staff pages of the people concerned.
 */

const EMPLOYEES = ["сотрудник", "сотрудника", "сотрудников"] as const;
const FAILED_DELIVERIES = ["неудачная доставка", "неудачные доставки", "неудачных доставок"] as const;

export function employeesText(n: number): string {
  return `${formatCount(n)} ${plural(n, EMPLOYEES)}`;
}

export function failedDeliveriesText(n: number, days: number): string {
  return `${formatCount(n)} ${plural(n, FAILED_DELIVERIES)} за ${days} ${plural(days, ["день", "дня", "дней"])}`;
}

type Person = { id: string; name: string | null };

function PeopleLinks({ ids, people }: { ids: string[]; people: Map<string, Person> }) {
  if (ids.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {ids.map((id) => (
        <li key={id}>
          <Link href={`/admin/users/${encodeURIComponent(id)}`} className="text-blue-700 hover:underline">
            {people.get(id)?.name ?? "Без имени"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProblemLine({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <li className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm text-zinc-900">
        <span className="font-semibold">{title}</span> — {detail}
      </p>
      {children}
    </li>
  );
}

export function ProblemsBlock({
  problems,
  people,
  days,
  eventLabels,
}: {
  problems: NotificationStats["problems"];
  people: Map<string, Person>;
  days: number;
  eventLabels: Map<string, string>;
}) {
  const { botNotStarted, botBlocked, noWorkingChannel, eventsWithoutPersonalRecipients } = problems;
  const lines = [
    botNotStarted.users > 0 || botNotStarted.failedDeliveries > 0,
    botBlocked.users > 0 || botBlocked.failedDeliveries > 0,
    noWorkingChannel.users > 0,
    eventsWithoutPersonalRecipients.count > 0,
  ];

  return (
    <section aria-labelledby="stats-problems" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 id="stats-problems" className="mb-3 text-sm font-semibold text-zinc-900">
        Проблемы
      </h3>
      {!lines.some(Boolean) ? (
        <p className="text-sm text-zinc-500">Проблем с доставкой не найдено.</p>
      ) : (
        <ul className="space-y-2">
          {lines[0] && (
            <ProblemLine
              title="Бот не запущен"
              detail={`${employeesText(botNotStarted.users)}, ${failedDeliveriesText(botNotStarted.failedDeliveries, days)}`}
            >
              <PeopleLinks ids={botNotStarted.userIds} people={people} />
            </ProblemLine>
          )}
          {lines[1] && (
            <ProblemLine
              title="Бот заблокирован"
              detail={`${employeesText(botBlocked.users)}, ${failedDeliveriesText(botBlocked.failedDeliveries, days)}`}
            >
              <PeopleLinks ids={botBlocked.userIds} people={people} />
            </ProblemLine>
          )}
          {lines[2] && (
            <ProblemLine title="Подписаны, но нет рабочего канала" detail={employeesText(noWorkingChannel.users)}>
              <PeopleLinks ids={noWorkingChannel.userIds} people={people} />
            </ProblemLine>
          )}
          {lines[3] && (
            <ProblemLine
              title="События, которых лично не получает никто"
              detail={formatCount(eventsWithoutPersonalRecipients.count)}
            >
              <p className="mt-1 text-sm text-zinc-600">
                {eventsWithoutPersonalRecipients.eventTypes.map((t) => eventLabels.get(t) ?? t).join(", ")}
                {" · "}
                <Link href="/admin/notifications/matrix" className="text-blue-700 hover:underline">
                  Открыть матрицу
                </Link>
              </p>
            </ProblemLine>
          )}
        </ul>
      )}
    </section>
  );
}

/** Problems of one employee (staff page, AC-D4.1). */
export function UserProblemsBlock({ problems, days }: { problems: UserNotificationStats["problems"]; days: number }) {
  const notStarted = problems.botNotStarted || problems.failedBotNotStarted > 0;
  const blocked = problems.botBlocked || problems.failedBotBlocked > 0;
  return (
    <section aria-label="Проблемы доставки" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h4 className="mb-2 text-sm font-semibold text-zinc-900">Проблемы</h4>
      {!notStarted && !blocked ? (
        <p className="text-sm text-zinc-500">Проблем с доставкой не найдено.</p>
      ) : (
        <ul className="space-y-2">
          {notStarted && (
            <ProblemLine
              title="Бот не запущен"
              detail={`${failedDeliveriesText(problems.failedBotNotStarted, days)}${problems.botNotStarted ? " · сейчас бот не запущен" : ""}`}
            />
          )}
          {blocked && (
            <ProblemLine
              title="Бот заблокирован"
              detail={`${failedDeliveriesText(problems.failedBotBlocked, days)}${problems.botBlocked ? " · сейчас бот заблокирован" : ""}`}
            />
          )}
        </ul>
      )}
    </section>
  );
}
