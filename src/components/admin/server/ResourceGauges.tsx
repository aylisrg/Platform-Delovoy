"use client";

import type { TimewebStatsDataPoint } from "@/modules/timeweb/types";

function Gauge({
  label,
  value,
  unit = "%",
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  const color =
    value > 90 ? "text-red-600" : value > 70 ? "text-yellow-600" : "text-green-600";
  const bgColor =
    value > 90 ? "bg-red-500" : value > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="mb-2 text-sm text-zinc-500">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>
        {value.toFixed(1)}
        <span className="text-base font-normal text-zinc-400">{unit}</span>
      </p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full transition-all ${bgColor}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResourceGauges({ data }: { data: TimewebStatsDataPoint[] }) {
  const latest = data.length > 0 ? data[data.length - 1] : null;

  if (!latest) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-zinc-400">
        Нет данных о ресурсах
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Gauge label="CPU" value={latest.cpuPercent} />
      <Gauge label="RAM" value={latest.ramPercent} />
      <Gauge label="Диск" value={latest.diskPercent} />
    </div>
  );
}

export function NetworkStats({ data }: { data: TimewebStatsDataPoint[] }) {
  const latest = data.length > 0 ? data[data.length - 1] : null;

  if (!latest) return null;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="mb-1 text-sm text-zinc-500">Входящий трафик</p>
        <p className="text-2xl font-bold text-zinc-900">
          {formatBytes(latest.networkInBytes)}
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <p className="mb-1 text-sm text-zinc-500">Исходящий трафик</p>
        <p className="text-2xl font-bold text-zinc-900">
          {formatBytes(latest.networkOutBytes)}
        </p>
      </div>
    </div>
  );
}
