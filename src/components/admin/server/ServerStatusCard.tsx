"use client";

import type { TimewebServerInfo } from "@/modules/timeweb/types";

const statusLabels: Record<string, { label: string; color: string }> = {
  on: { label: "Работает", color: "bg-green-500" },
  off: { label: "Выключен", color: "bg-zinc-400" },
  installing: { label: "Установка", color: "bg-yellow-400" },
  starting: { label: "Запускается", color: "bg-blue-400" },
  stopping: { label: "Останавливается", color: "bg-orange-400" },
  rebooting: { label: "Перезагрузка", color: "bg-blue-400" },
};

export function ServerStatusCard({ info }: { info: TimewebServerInfo }) {
  const statusInfo = statusLabels[info.status] ?? {
    label: info.status,
    color: "bg-zinc-400",
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">{info.name}</h2>
        <span className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${statusInfo.color}`} />
          {statusInfo.label}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-zinc-500">ОС</dt>
          <dd className="font-medium text-zinc-900">
            {info.os.name} {info.os.version}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">IP-адрес</dt>
          <dd className="font-mono font-medium text-zinc-900">
            {info.ip ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">CPU</dt>
          <dd className="font-medium text-zinc-900">
            {info.configuration.cpu} vCPU
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">RAM</dt>
          <dd className="font-medium text-zinc-900">
            {Math.round(info.configuration.ram / 1024)} ГБ
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Диск</dt>
          <dd className="font-medium text-zinc-900">
            {Math.round(info.configuration.disk / 1024)} ГБ
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Локация</dt>
          <dd className="font-medium text-zinc-900">{info.location}</dd>
        </div>
      </dl>
    </div>
  );
}
