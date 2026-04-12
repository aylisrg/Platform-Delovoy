import type { AuditLogEntry } from "@/modules/monitoring/architect-types";

type Props = {
  logs: AuditLogEntry[];
};

export function AuditTable({ logs }: Props) {
  if (logs.length === 0) {
    return <p className="text-sm text-zinc-400 py-4">Чистый лог. Либо никто ничего не делал, либо кто-то хорошо прячется.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
            <th className="pb-2 pr-4 font-medium whitespace-nowrap">Время</th>
            <th className="pb-2 pr-4 font-medium">Пользователь</th>
            <th className="pb-2 pr-4 font-medium">Действие</th>
            <th className="pb-2 pr-4 font-medium">Сущность</th>
            <th className="pb-2 font-medium">Детали</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-zinc-50 align-top">
              <td className="py-2 pr-4 whitespace-nowrap text-xs text-zinc-400">
                {new Date(log.createdAt).toLocaleString("ru-RU")}
              </td>
              <td className="py-2 pr-4">
                <p className="text-zinc-700">{log.userName ?? "—"}</p>
                {log.userEmail && (
                  <p className="text-xs text-zinc-400">{log.userEmail}</p>
                )}
              </td>
              <td className="py-2 pr-4">
                <span className="font-mono text-xs text-zinc-600">{log.action}</span>
              </td>
              <td className="py-2 pr-4">
                <span className="text-zinc-700">{log.entity}</span>
                {log.entityId && (
                  <p className="font-mono text-xs text-zinc-400">{log.entityId}</p>
                )}
              </td>
              <td className="py-2">
                {log.metadata != null ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600">
                      Показать
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-600 max-w-xs">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <span className="text-xs text-zinc-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
