import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { forbidden } from "next/navigation";
import { hasAdminSectionAccess } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { MarkPaidButton } from "@/components/admin/rental/mark-paid-button";

export const dynamic = "force-dynamic";

export default async function RentalPaymentsPage() {
  const session = await auth();
  if (!session?.user?.id) forbidden();
  if (session.user.role !== "SUPERADMIN") {
    const ok = await hasAdminSectionAccess(session.user.id, "rental");
    if (!ok) forbidden();
  }

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const payments = await prisma.rentalPayment.findMany({
    where: {
      paidAt: null,
      dueDate: { lte: in30Days },
      contract: { status: { in: ["ACTIVE", "EXPIRING"] } },
    },
    include: {
      contract: {
        include: {
          tenant: { select: { id: true, companyName: true, phone: true } },
          office: { select: { number: true, building: true, floor: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  });

  return (
    <>
      <AdminHeader title="Аренда — ожидают оплаты" />
      <div className="p-6 lg:p-8 max-w-6xl">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">
              Неоплаченные платежи (ближайшие 30 дней + просроченные)
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              {payments.length} позиций
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Срок</th>
                    <th className="py-2 pr-3 font-medium">Период</th>
                    <th className="py-2 pr-3 font-medium">Арендатор</th>
                    <th className="py-2 pr-3 font-medium">Офис</th>
                    <th className="py-2 pr-3 font-medium">Сумма</th>
                    <th className="py-2 pr-3 font-medium">Этапы</th>
                    <th className="py-2 font-medium">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const overdue = p.dueDate < now;
                    const daysDiff = Math.floor(
                      (p.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                    );
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-zinc-50 ${
                          overdue ? "bg-red-50/60" : daysDiff <= 3 ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <div className="font-medium text-zinc-900">
                            {p.dueDate.toLocaleDateString("ru-RU")}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {overdue
                              ? `${Math.abs(daysDiff)} дн. просрочки`
                              : daysDiff === 0
                                ? "сегодня"
                                : `через ${daysDiff} дн.`}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-zinc-600 whitespace-nowrap">
                          {p.periodMonth.toString().padStart(2, "0")}/{p.periodYear}
                        </td>
                        <td className="py-2 pr-3 text-zinc-900">
                          {p.contract.tenant.companyName}
                          {p.contract.tenant.phone && (
                            <div className="text-xs text-zinc-500">
                              <a
                                href={`tel:${p.contract.tenant.phone}`}
                                className="hover:underline"
                              >
                                {p.contract.tenant.phone}
                              </a>
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-zinc-600">
                          К{p.contract.office.building}·{p.contract.office.number}
                        </td>
                        <td className="py-2 pr-3 font-semibold text-zinc-900">
                          {Number(p.amount).toLocaleString("ru-RU")} {p.currency === "RUB" ? "₽" : p.currency}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-col gap-1">
                            {p.firstReminderSentAt && (
                              <Badge variant="info">T-N отправлено</Badge>
                            )}
                            {p.dueDateReminderSentAt && (
                              <Badge variant="warning">T=0 отправлено</Badge>
                            )}
                            {p.escalatedAt && <Badge variant="danger">Эскалировано</Badge>}
                          </div>
                        </td>
                        <td className="py-2">
                          <MarkPaidButton paymentId={p.id} />
                        </td>
                      </tr>
                    );
                  })}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-400">
                        Нет неоплаченных платежей в ближайшие 30 дней.
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
