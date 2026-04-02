import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type StatusWidgetProps = {
  title: string;
  value: string | number;
  status?: "success" | "warning" | "danger" | "info";
  description?: string;
};

export function StatusWidget({ title, value, status, description }: StatusWidgetProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-500">{title}</span>
          {status && (
            <Badge variant={status}>
              {status === "success" ? "OK" : status === "warning" ? "Внимание" : status === "danger" ? "Ошибка" : "Инфо"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-zinc-900">{value}</p>
        {description && (
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
