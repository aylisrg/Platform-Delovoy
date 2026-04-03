import { Badge } from "@/components/ui/badge";
import type { EventLevel } from "@prisma/client";

type SystemEventRow = {
  id: string;
  level: EventLevel;
  source: string;
  message: string;
  metadata: unknown;
  createdAt: Date | string;
};

const levelVariant: Record<EventLevel, "success" | "warning" | "danger" | "info"> = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "danger",
  CRITICAL: "danger",
};

type Props = {
  events: SystemEventRow[];
};

export function EventsTable({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-zinc-400 py-4">Нет событий</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
            <th className="pb-2 pr-4 font-medium">Уровень</th>
            <th className="pb-2 pr-4 font-medium">Источник</th>
            <th className="pb-2 pr-4 font-medium">Сообщение</th>
            <th className="pb-2 font-medium whitespace-nowrap">Время</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-zinc-50 align-top">
              <td className="py-2 pr-4">
                <Badge variant={levelVariant[event.level]}>{event.level}</Badge>
              </td>
              <td className="py-2 pr-4">
                <span className="font-mono text-xs text-zinc-500">{event.source}</span>
              </td>
              <td className="py-2 pr-4 max-w-md">
                <p className="text-zinc-700">{event.message}</p>
                {event.metadata != null && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600">
                      Метаданные
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-600">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </td>
              <td className="py-2 whitespace-nowrap text-xs text-zinc-400">
                {new Date(event.createdAt).toLocaleString("ru-RU")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
