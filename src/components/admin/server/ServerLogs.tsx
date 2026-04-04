"use client";

import type { TimewebLogEntry } from "@/modules/timeweb/types";

export function ServerLogs({ logs }: { logs: TimewebLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-zinc-400">
        Нет логов
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-6 py-4">
        <h3 className="text-base font-semibold text-zinc-900">Логи сервера</h3>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-zinc-50">
            <tr>
              <th className="px-6 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                Время
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                Событие
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {logs.map((log, idx) => (
              <tr key={idx} className="text-sm">
                <td className="whitespace-nowrap px-6 py-2 font-mono text-zinc-500">
                  {new Date(log.timestamp).toLocaleString("ru-RU")}
                </td>
                <td className="px-6 py-2 text-zinc-900">{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
