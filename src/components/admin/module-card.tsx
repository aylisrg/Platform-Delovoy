import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ModuleCardProps = {
  name: string;
  slug: string;
  description?: string | null;
  isActive: boolean;
};

export function ModuleCard({ name, slug, description, isActive }: ModuleCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900">{name}</h3>
            <Badge variant={isActive ? "success" : "default"}>
              {isActive ? "Активен" : "Отключён"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
          <p className="mt-2 text-xs text-zinc-400 font-mono">{slug}</p>
        </div>
      </CardContent>
    </Card>
  );
}
