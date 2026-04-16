"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  SystemStatusReport,
  ComponentStatus,
} from "@/modules/monitoring/system-status-service";

const POLL_INTERVAL_MS = 30_000;

const badgeVariant: Record<ComponentStatus, "success" | "warning" | "danger"> = {
  ok: "success",
  warning: "warning",
  critical: "danger",
};

const badgeLabel: Record<ComponentStatus, string> = {
  ok: "В порядке",
  warning: "Внимание",
  critical: "Критично",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`;
}

function statusDotColor(status: ComponentStatus): string {
  if (status === "ok") return "bg-green-500";
  if (status === "warning") return "bg-yellow-500";
  return "bg-red-500";
}

type MetricRowProps = {
  label: string;
  value: string;
  status: ComponentStatus;
  detail?: string;
};

function MetricRow({ label, value, status, detail }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${statusDotColor(status)}`} />
        <span className="text-sm text-zinc-600">{label}</span>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-zinc-900">{value}</div>
        {detail && <div className="text-xs text-zinc-400">{detail}</div>}
      </div>
    </div>
  );
}

export function ServerStatusCard() {
  const [data, setData] = useState<SystemStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/system/status", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body?.success) {
          setError(body?.error?.message ?? "Не удалось получить статус");
          return;
        }
        setData(body.data as SystemStatusReport);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Сетевая ошибка");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-zinc-500">Состояние сервера</div>
            {data && (
              <div className="mt-1 text-xs text-zinc-400">
                {data.host.hostname} · uptime {formatUptime(data.host.uptimeSeconds)}
              </div>
            )}
          </div>
          {data ? (
            <Badge variant={badgeVariant[data.overall]}>{badgeLabel[data.overall]}</Badge>
          ) : (
            <Badge variant="default">{isLoading ? "Загрузка…" : "Нет данных"}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && !data && (
          <p className="text-sm text-red-600">Ошибка: {error}</p>
        )}
        {data && (
          <>
            <p className="text-base font-semibold text-zinc-900">{data.summary}</p>
            <div className="mt-3 divide-y divide-zinc-100">
              <MetricRow
                label="CPU"
                status={data.cpu.status}
                value={formatPercent(data.cpu.loadPerCore * 100)}
                detail={`load ${data.cpu.loadAvg1m.toFixed(2)} · ${data.cpu.cores} ядер`}
              />
              <MetricRow
                label="Память"
                status={data.memory.status}
                value={formatPercent(data.memory.usedPercent)}
                detail={`${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`}
              />
              {data.disk && (
                <MetricRow
                  label="Диск"
                  status={data.disk.status}
                  value={formatPercent(data.disk.usedPercent)}
                  detail={`${formatBytes(data.disk.usedBytes)} / ${formatBytes(data.disk.totalBytes)}`}
                />
              )}
              <MetricRow
                label="База данных"
                status={data.database.status}
                value={data.database.latencyMs !== null ? `${data.database.latencyMs} мс` : "—"}
                detail={data.database.error}
              />
              <MetricRow
                label="Redis"
                status={data.redis.status}
                value={data.redis.latencyMs !== null ? `${data.redis.latencyMs} мс` : "—"}
                detail={data.redis.error}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
