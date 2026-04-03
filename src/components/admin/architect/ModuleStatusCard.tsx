import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ModuleMapEntry, HealthStatus } from "@/modules/monitoring/architect-types";

const statusVariant: Record<HealthStatus, "success" | "warning" | "danger" | "default"> = {
  healthy: "success",
  degraded: "warning",
  unhealthy: "danger",
  offline: "default",
};

const statusLabel: Record<HealthStatus, string> = {
  healthy: "Онлайн",
  degraded: "Деградация",
  unhealthy: "Недоступен",
  offline: "Офлайн",
};

const statusDot: Record<HealthStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-400",
  unhealthy: "bg-red-500",
  offline: "bg-zinc-400",
};

type Props = {
  entry: ModuleMapEntry;
};

export function ModuleStatusCard({ entry }: Props) {
  const { slug, name, description, isActive, healthStatus, metrics, lastChecked } = entry;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDot[healthStatus]}`}
            />
            <span className="font-semibold text-zinc-900">{name}</span>
          </div>
          <Badge variant={statusVariant[healthStatus]}>{statusLabel[healthStatus]}</Badge>
        </div>
        <p className="text-xs text-zinc-400 font-mono mt-1">{slug}</p>
      </CardHeader>
      <CardContent>
        {description && (
          <p className="text-sm text-zinc-500 mb-3">{description}</p>
        )}

        {Object.keys(metrics).length > 0 && (
          <div className="mb-3 space-y-1">
            {Object.entries(metrics).map(([key, val]) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-zinc-400">{key}</span>
                <span className="text-zinc-700 font-mono">{String(val)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-zinc-400">
            {new Date(lastChecked).toLocaleTimeString("ru-RU")}
          </span>
          <div className="flex items-center gap-2">
            {!isActive && (
              <span className="text-xs text-zinc-400">Отключён</span>
            )}
            <Link
              href={`/admin/architect/modules/${slug}`}
              className="text-xs text-blue-600 hover:underline"
            >
              Конфиг
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
