import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listResources } from "@/modules/gazebos/service";
import { ResourceEditor } from "@/components/admin/gazebos/resource-editor";
import { ResourceCreator } from "@/components/admin/gazebos/resource-creator";

export const dynamic = "force-dynamic";

export default async function GazebosResourcesPage() {
  // activeOnly=false — админ видит и отключённые ресурсы (бейдж «Отключена»),
  // но не мягко удалённые: listResources() всегда фильтрует deletedAt (#675).
  const resources = await listResources(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">Беседки ({resources.length})</h2>
          <ResourceCreator />
        </div>
        <p className="text-xs text-zinc-400 mt-1">
          Управление беседками: название, вместимость, цена, статус
        </p>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <p className="text-sm text-zinc-400 py-4">Нет беседок. Добавьте первую!</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-zinc-500">
                <th className="pb-3 font-medium">Название</th>
                <th className="pb-3 font-medium">Вместимость</th>
                <th className="pb-3 font-medium">Пн–Чт, час</th>
                <th className="pb-3 font-medium">Пт–Вс, час</th>
                <th className="pb-3 font-medium">Статус</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => {
                const pl = (r.metadata as { priceList?: { weekdayHour?: number; weekendHour?: number } } | null)?.priceList;
                const weekdayHour = pl?.weekdayHour ?? (r.pricePerHour != null ? Number(r.pricePerHour) : null);
                const weekendHour = pl?.weekendHour ?? null;
                return (
                  <tr key={r.id} className="border-b border-zinc-50">
                    <td className="py-3 text-zinc-900 font-medium">{r.name}</td>
                    <td className="py-3 text-zinc-600">{r.capacity ?? "—"} чел.</td>
                    <td className="py-3 text-zinc-600">{weekdayHour != null ? `${weekdayHour} ₽` : "—"}</td>
                    <td className="py-3 text-zinc-600">{weekendHour != null ? `${weekendHour} ₽` : "—"}</td>
                    <td className="py-3">
                      <Badge variant={r.isActive ? "success" : "default"}>
                        {r.isActive ? "Активна" : "Отключена"}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <ResourceEditor
                        resource={{
                          id: r.id,
                          name: r.name,
                          description: r.description,
                          capacity: r.capacity,
                          pricePerHour: r.pricePerHour != null ? Number(r.pricePerHour) : null,
                          isActive: r.isActive,
                          metadata: r.metadata,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
