import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { forbidden } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ManagerTaskList } from "@/components/admin/rental/manager-task-list";

export const dynamic = "force-dynamic";

export default async function RentalTasksPage() {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  if (session.user.role !== "SUPERADMIN") {
    const ok = await hasAdminSectionAccess(session.user.id, "rental");
    if (!ok) forbidden();
  }

  const tasks = await prisma.managerTask.findMany({
    where: { moduleSlug: "rental" },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const contractIds = [...new Set(tasks.map((t) => t.contractId).filter((v): v is string => !!v))];
  const contracts = contractIds.length
    ? await prisma.rentalContract.findMany({
        where: { id: { in: contractIds } },
        include: {
          tenant: { select: { companyName: true, contactName: true, phone: true, email: true } },
          office: { select: { number: true, building: true, floor: true } },
        },
      })
    : [];
  const paymentIds = [...new Set(tasks.map((t) => t.paymentId).filter((v): v is string => !!v))];
  const payments = paymentIds.length
    ? await prisma.rentalPayment.findMany({ where: { id: { in: paymentIds } } })
    : [];

  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const paymentMap = new Map(payments.map((p) => [p.id, p]));

  const enriched = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    type: t.type,
    paymentId: t.paymentId,
    createdAt: t.createdAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    resolution: t.resolution,
    resolutionNote: t.resolutionNote,
    contract: t.contractId
      ? (() => {
          const c = contractMap.get(t.contractId);
          return c
            ? {
                contractNumber: c.contractNumber,
                tenant: c.tenant,
                office: c.office,
              }
            : null;
        })()
      : null,
    payment: t.paymentId
      ? (() => {
          const p = paymentMap.get(t.paymentId);
          return p
            ? {
                dueDate: p.dueDate.toISOString(),
                amount: p.amount.toString(),
                paidAt: p.paidAt?.toISOString() ?? null,
              }
            : null;
        })()
      : null,
  }));

  const openCount = tasks.filter((t) => t.status === "OPEN").length;

  return (
    <>
      <AdminHeader title="Аренда — задачи менеджера" />
      <div className="p-6 lg:p-8 max-w-5xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">
                Задачи
                {openCount > 0 && (
                  <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                    {openCount}
                  </span>
                )}
              </h2>
              <span className="text-sm text-zinc-500">{tasks.length} всего</span>
            </div>
          </CardHeader>
          <CardContent>
            <ManagerTaskList tasks={enriched} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
