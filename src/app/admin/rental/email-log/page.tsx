import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { forbidden } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  MANUAL: "Ручное",
  PAYMENT_PRE_REMINDER: "T-N",
  PAYMENT_DUE_REMINDER: "T=0",
  ESCALATION_INTERNAL: "Эскалация",
};

export default async function RentalEmailLogPage() {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  if (session.user.role !== "SUPERADMIN") {
    const ok = await hasAdminSectionAccess(session.user.id, "rental");
    if (!ok) forbidden();
  }

  const logs = await prisma.emailLog.findMany({
    where: { moduleSlug: "rental" },
    orderBy: { sentAt: "desc" },
    take: 100,
  });

  const tenantIds = [...new Set(logs.map((l) => l.tenantId).filter((v): v is string => !!v))];
  const tenants = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, companyName: true },
      })
    : [];
  const tenantMap = new Map(tenants.map((t) => [t.id, t]));

  return (
    <>
      <AdminHeader title="Аренда — журнал писем" />
      <div className="p-6 lg:p-8 max-w-6xl">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">Последние 100 писем</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Дата</th>
                    <th className="py-2 pr-3 font-medium">Тип</th>
                    <th className="py-2 pr-3 font-medium">Арендатор</th>
                    <th className="py-2 pr-3 font-medium">Кому</th>
                    <th className="py-2 pr-3 font-medium">Тема</th>
                    <th className="py-2 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-50">
                      <td className="py-2 pr-3 text-xs text-zinc-500 whitespace-nowrap">
                        {l.sentAt.toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{TYPE_LABEL[l.type] ?? l.type}</span>
                      </td>
                      <td className="py-2 pr-3 text-zinc-600">
                        {l.tenantId ? tenantMap.get(l.tenantId)?.companyName ?? "—" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-zinc-600 max-w-xs truncate">
                        {l.to.join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-zinc-900 max-w-md truncate">{l.subject}</td>
                      <td className="py-2">
                        {l.status === "SENT" ? (
                          <Badge variant="success">Отправлено</Badge>
                        ) : (
                          <Badge variant="danger">Ошибка</Badge>
                        )}
                        {l.error && (
                          <p className="mt-1 text-xs text-red-600 max-w-xs truncate">{l.error}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-zinc-400">
                        Пока писем не было.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
