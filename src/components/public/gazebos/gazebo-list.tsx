import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GazeboResource } from "@/modules/gazebos/types";

type Props = {
  resources: GazeboResource[];
};

export function GazeboList({ resources }: Props) {
  if (resources.length === 0) {
    return <p className="text-zinc-400">Беседки пока не добавлены</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource) => (
        <Card key={resource.id}>
          <CardContent>
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">{resource.name}</h3>
              <Badge variant="success">Доступна</Badge>
            </div>
            {resource.description && (
              <p className="mt-2 text-sm text-zinc-500">{resource.description}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-600">
              {resource.capacity && (
                <span>Вместимость: до {resource.capacity} чел.</span>
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
