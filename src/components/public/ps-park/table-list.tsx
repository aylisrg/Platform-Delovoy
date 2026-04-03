import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PSTableResource } from "@/modules/ps-park/types";

type Props = {
  resources: PSTableResource[];
};

export function TableList({ resources }: Props) {
  if (resources.length === 0) {
    return <p className="text-zinc-400">Столы пока не добавлены</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource) => (
        <Card key={resource.id}>
          <CardContent>
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">{resource.name}</h3>
              <Badge variant="success">Доступен</Badge>
            </div>
            {resource.description && (
              <p className="mt-2 text-sm text-zinc-500">{resource.description}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-600">
              {resource.capacity && (
                <span>Игроков: до {resource.capacity} чел.</span>
              )}
              {resource.pricePerHour && (
                <span className="font-medium text-zinc-900">
                  {Number(resource.pricePerHour)} ₽/час
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
