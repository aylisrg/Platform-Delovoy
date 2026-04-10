import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import type { ContractStatus, OfficeStatus, InquiryStatus } from "@prisma/client";
import { ContractActions } from "@/components/admin/rental/contract-actions";
import { InquiryActions } from "@/components/admin/rental/inquiry-actions";

export const dynamic = "force-dynamic";

const inquiryStatusLabel: Record<InquiryStatus, string> = {
  NEW: "Новая",
  IN_PROGRESS: "В работе",
  CONVERTED: "Клиент",
  CLOSED: "Закрыта",
};

const inquiryStatusVariant: Record<InquiryStatus, "warning" | "success" | "default" | "info" | "danger"> = {
  NEW: "warning",
  IN_PROGRESS: "info",
  CONVERTED: "success",
  CLOSED: "default",
};

const contractStatusLabel: Record<ContractStatus, string> = {
  DRAFT: "Черновик",
  ACTIVE: "Активен",
  EXPIRING: "Истекает",
  EXPIRED: "Истёк",
  TERMINATED: "Расторгнут",
};

const contractStatusVariant: Record<ContractStatus, "warning" | "success" | "default" | "info" | "danger"> = {
  DRAFT: "info",
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "default",
  TERMINATED: "danger",
};

const officeStatusLabel: Record<OfficeStatus, string> = {
  AVAILABLE: "Свободен",
  OCCUPIED: "Занят",
  MAINTENANCE: "Обслуживание",
};

const officeStatusVariant: Record<OfficeStatus, "success" | "default" | "warning"> = {
  AVAILABLE: "success",
  OCCUPIED: "default",
  MAINTENANCE: "warning",
};

export default async function RentalManagerPage() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [offices, tenants, contracts, expiringCount, newThisMonth, totalRevenue, inquiries] =
    await Promise.all([
      prisma.office.findMany({ orderBy: [{ floor: "asc" }, { number: "asc" }] }),
      prisma.tenant.findMany({
        orderBy: { companyName: "asc" },
        include: { _count: { select: { contracts: true } } },
      }),
      prisma.rentalContract.findMany({
        include: { tenant: true, office: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["ACTIVE", "EXPIRING"] },
          endDate: { gte: now, lte: in30Days },
        },
      }),
      prisma.rentalContract.count({
        where: { startDate: { gte: monthStart } },
      }),
      prisma.rentalContract.findMany({
        where: { status: { in: ["ACTIVE", "EXPIRING"] } },
        select: { monthlyRate: true },
      }),
      prisma.rentalInquiry.findMany({
        include: { office: { select: { number: true, floor: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

  const newInquiries = inquiries.filter((i) => !i.isRead).length;

  const monthlyRevenue = totalRevenue.reduce(
    (sum, c) => sum + Number(c.monthlyRate),
    0
  );
  const activeContracts = contracts.filter((c) =>
    ["ACTIVE", "EXPIRING"].includes(c.status)
  ).length;
  const occupiedOffices = offices.filter((o) => o.status === "OCCUPIED").length;

  return (
    <>
      <AdminHeader title="Аренда офисов" />
      <div className="p-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatusWidget
            title="Офисов занято"
            value={`${occupiedOffices} / ${offices.length}`}
            status="info"
            description={`${Math.round((occupiedOffices / (offices.length || 1)) * 100)}% занятость`}
          />
          <StatusWidget
            title="Выручка/месяц"
            value={`${monthlyRevenue.toLocaleString("ru-RU")} ₽`}
            status="success"
            description={`${activeContracts} активных договоров`}
          />
          <StatusWidget
            title="Истекают (30 дней)"
            value={expiringCount}
            status={expiringCount > 0 ? "warning" : "success"}
          />
          <StatusWidget
            title="Новых договоров"
            value={newThisMonth}
            status="info"
            description="в этом месяце"
          />
        </div>

        {/* === OFFICES === */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Офисы</h2>
              <span className="text-sm text-zinc-500">{offices.length} всего</span>
            </div>
          </CardHeader>
          <CardContent>
            {offices.length === 0 ? (
              <p className="text-sm text-zinc-400">Офисы не добавлены</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Номер</th>
                    <th className="pb-3 font-medium">Этаж</th>
                    <th className="pb-3 font-medium">Площадь</th>
                    <th className="pb-3 font-medium">Цена/месяц</th>
                    <th className="pb-3 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {offices.map((office) => (
                    <tr key={office.id} className="border-b border-zinc-50">
                      <td className="py-3 font-medium text-zinc-900">№{office.number}</td>
                      <td className="py-3 text-zinc-600">{office.floor} эт.</td>
                      <td className="py-3 text-zinc-600">{Number(office.area)} м²</td>
                      <td className="py-3 text-zinc-600">
                        {Number(office.pricePerMonth).toLocaleString("ru-RU")} ₽
                      </td>
                      <td className="py-3">
                        <Badge variant={officeStatusVariant[office.status]}>
                          {officeStatusLabel[office.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* === TENANTS (CRM) === */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Арендаторы</h2>
              <span className="text-sm text-zinc-500">{tenants.length} компаний</span>
            </div>
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <p className="text-sm text-zinc-400">Арендаторы не добавлены</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Компания</th>
                    <th className="pb-3 font-medium">Контакт</th>
                    <th className="pb-3 font-medium">Телефон</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">ИНН</th>
                    <th className="pb-3 font-medium">Договоров</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-zinc-50">
                      <td className="py-3 font-medium text-zinc-900">{tenant.companyName}</td>
                      <td className="py-3 text-zinc-600">{tenant.contactName}</td>
                      <td className="py-3 text-zinc-600">
                        {tenant.phone ? (
                          <a href={`tel:${tenant.phone}`} className="text-blue-600 hover:underline">
                            {tenant.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {tenant.email ? (
                          <a href={`mailto:${tenant.email}`} className="text-blue-600 hover:underline">
                            {tenant.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 text-zinc-600">{tenant.inn ?? "—"}</td>
                      <td className="py-3 text-zinc-600">{tenant._count.contracts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* === CONTRACTS === */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900">Договоры</h2>
              <span className="text-sm text-zinc-500">{contracts.length} записей</span>
            </div>
          </CardHeader>
          <CardContent>
            {contracts.length === 0 ? (
              <p className="text-sm text-zinc-400">Договоры не добавлены</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="pb-3 font-medium">Офис</th>
                    <th className="pb-3 font-medium">Арендатор</th>
                    <th className="pb-3 font-medium">Период</th>
                    <th className="pb-3 font-medium">Ставка/мес</th>
                    <th className="pb-3 font-medium">Статус</th>
                    <th className="pb-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id} className="border-b border-zinc-50">
                      <td className="py-3 font-medium text-zinc-900">
                        №{c.office.number}
                        <span className="text-zinc-400 font-normal"> ({c.office.floor} эт.)</span>
                      </td>
                      <td className="py-3 text-zinc-600">{c.tenant.companyName}</td>
                      <td className="py-3 text-zinc-600 whitespace-nowrap">
                        {new Date(c.startDate).toLocaleDateString("ru-RU")}
                        {" — "}
                        {new Date(c.endDate).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="py-3 text-zinc-600">
                        {Number(c.monthlyRate).toLocaleString("ru-RU")} ₽
                      </td>
                      <td className="py-3">
                        <Badge variant={contractStatusVariant[c.status]}>
                          {contractStatusLabel[c.status]}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <ContractActions contractId={c.id} currentStatus={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* === FINANCIAL REPORT PREVIEW === */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-zinc-900">
              Отчёт за{" "}
              {now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-zinc-500">Выручка (прогноз)</p>
                <p className="text-xl font-bold text-zinc-900 mt-1">
                  {monthlyRevenue.toLocaleString("ru-RU")} ₽
                </p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-zinc-500">Занятость</p>
                <p className="text-xl font-bold text-zinc-900 mt-1">
                  {Math.round((occupiedOffices / (offices.length || 1)) * 100)}%
                </p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-zinc-500">Активных договоров</p>
                <p className="text-xl font-bold text-zinc-900 mt-1">{activeContracts}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-4">
                <p className="text-zinc-500">Истекают скоро</p>
                <p className={`text-xl font-bold mt-1 ${expiringCount > 0 ? "text-amber-600" : "text-zinc-900"}`}>
                  {expiringCount}
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-400">
              Полный отчёт доступен через API:{" "}
              <code className="font-mono bg-zinc-100 px-1 rounded">
                GET /api/rental/reports?year={now.getFullYear()}&amp;month={now.getMonth() + 1}
              </code>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
