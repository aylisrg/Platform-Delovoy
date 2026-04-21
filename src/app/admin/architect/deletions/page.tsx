import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  entity?: string;
  moduleSlug?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  offset?: string;
  limit?: string;
}>;

type Props = { searchParams: SearchParams };

export default async function DeletionsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin?callbackUrl=/admin/architect/deletions");
  // Only SUPERADMIN and ADMIN can see the journal — ADMIN has read-only visibility
  // for transparency (so ADMIN can see what SUPERADMIN removed). USER/MANAGER are forbidden.
  if (session.user.role !== "SUPERADMIN" && session.user.role !== "ADMIN") {
    redirect("/admin/forbidden");
  }

  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit ?? 50), 100);
  const offset = Math.max(Number(sp.offset ?? 0), 0);

  const where: Record<string, unknown> = {};
  if (sp.entity) where.entity = sp.entity;
  if (sp.moduleSlug) where.moduleSlug = sp.moduleSlug;
  // `userId` filter is intentionally open to any ADMIN/SUPERADMIN viewer:
  // the deletion journal is a transparency mechanism. ADMIN must be able
  // to audit what other operators — including SUPERADMIN — deleted, so
  // we deliberately allow filtering by any userId here. The page itself
  // is already gated to ADMIN+SUPERADMIN above.
  if (sp.userId) where.userId = sp.userId;
  if (sp.dateFrom || sp.dateTo) {
    where.createdAt = {
      ...(sp.dateFrom ? { gte: new Date(sp.dateFrom) } : {}),
      ...(sp.dateTo ? { lte: new Date(sp.dateTo) } : {}),
    };
  }

  let rows: Awaited<ReturnType<typeof prisma.deletionLog.findMany>> = [];
  let total = 0;
  try {
    [rows, total] = await Promise.all([
      prisma.deletionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.deletionLog.count({ where }),
    ]);
  } catch {
    // DB may be unavailable in dev
  }

  return (
    <>
      <AdminHeader title="Журнал удалений" />
      <div className="p-8 space-y-6">
        <form method="GET" action="/admin/architect/deletions" className="flex flex-wrap gap-3">
          <input type="hidden" name="offset" value="0" />
          <select
            name="moduleSlug"
            defaultValue={sp.moduleSlug ?? ""}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          >
            <option value="">Все модули</option>
            <option value="gazebos">Беседки</option>
            <option value="ps-park">PS Park</option>
            <option value="cafe">Кафе</option>
            <option value="inventory">Склад</option>
          </select>
          <input
            name="entity"
            type="text"
            defaultValue={sp.entity ?? ""}
            placeholder="Сущность (Booking, Order, MenuItem...)"
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          />
          <input
            name="dateFrom"
            type="date"
            defaultValue={sp.dateFrom ?? ""}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          />
          <input
            name="dateTo"
            type="date"
            defaultValue={sp.dateTo ?? ""}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          />
          <button
            type="submit"
            className="rounded border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Применить
          </button>
          <a
            href="/admin/architect/deletions"
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600"
          >
            Сбросить
          </a>
        </form>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Удаления</h2>
              <span className="text-xs text-zinc-400">{total} записей</span>
            </div>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="py-4 text-sm text-zinc-400">Пока никто ничего не удалял.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
                      <th className="pb-2 pr-4 font-medium whitespace-nowrap">Когда</th>
                      <th className="pb-2 pr-4 font-medium">Кто</th>
                      <th className="pb-2 pr-4 font-medium">Модуль</th>
                      <th className="pb-2 pr-4 font-medium">Сущность</th>
                      <th className="pb-2 pr-4 font-medium">Описание</th>
                      <th className="pb-2 pr-4 font-medium">Причина</th>
                      <th className="pb-2 pr-4 font-medium">IP</th>
                      <th className="pb-2 font-medium">Снапшот</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-zinc-50 align-top">
                        <td className="py-2 pr-4 whitespace-nowrap text-xs text-zinc-400">
                          {new Date(row.createdAt).toLocaleString("ru-RU")}
                        </td>
                        <td className="py-2 pr-4">
                          <p className="text-zinc-700">{row.userName ?? "—"}</p>
                          <p className="text-xs text-zinc-400">{row.userEmail ?? row.userId}</p>
                          <p className="text-[10px] uppercase tracking-wide text-zinc-400">{row.userRole}</p>
                        </td>
                        <td className="py-2 pr-4 text-zinc-700">{row.moduleSlug ?? "—"}</td>
                        <td className="py-2 pr-4">
                          <span className="text-zinc-700">{row.entity}</span>
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-400">
                            {row.deletionType}
                          </span>
                          <p className="font-mono text-xs text-zinc-400">{row.entityId}</p>
                        </td>
                        <td className="py-2 pr-4 text-zinc-700">{row.entityLabel ?? "—"}</td>
                        <td className="py-2 pr-4 text-zinc-700 max-w-[240px] break-words">
                          {row.reason ?? <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-zinc-500">{row.ipAddress ?? "—"}</td>
                        <td className="py-2">
                          <details>
                            <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600">
                              Показать
                            </summary>
                            <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-xs text-zinc-600 max-w-md">
                              {JSON.stringify(row.snapshot, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
              <span>
                Показано {rows.length} из {total}
              </span>
              <div className="flex gap-2">
                {offset > 0 && (
                  <a
                    className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50"
                    href={`/admin/architect/deletions?${new URLSearchParams({
                      ...(sp.entity ? { entity: sp.entity } : {}),
                      ...(sp.moduleSlug ? { moduleSlug: sp.moduleSlug } : {}),
                      ...(sp.dateFrom ? { dateFrom: sp.dateFrom } : {}),
                      ...(sp.dateTo ? { dateTo: sp.dateTo } : {}),
                      offset: String(Math.max(0, offset - limit)),
                      limit: String(limit),
                    }).toString()}`}
                  >
                    Назад
                  </a>
                )}
                {offset + rows.length < total && (
                  <a
                    className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50"
                    href={`/admin/architect/deletions?${new URLSearchParams({
                      ...(sp.entity ? { entity: sp.entity } : {}),
                      ...(sp.moduleSlug ? { moduleSlug: sp.moduleSlug } : {}),
                      ...(sp.dateFrom ? { dateFrom: sp.dateFrom } : {}),
                      ...(sp.dateTo ? { dateTo: sp.dateTo } : {}),
                      offset: String(offset + limit),
                      limit: String(limit),
                    }).toString()}`}
                  >
                    Вперёд
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
