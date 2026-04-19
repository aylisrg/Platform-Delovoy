import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusWidget } from "@/components/admin/status-widget";
import { prisma } from "@/lib/db";
import type { ContractStatus, InquiryStatus } from "@prisma/client";
import { InquiryActions } from "@/components/admin/rental/inquiry-actions";
import { RentalTabs } from "@/components/admin/rental/rental-tabs";
import { TenantList } from "@/components/admin/rental/tenant-list";
import { OfficeList } from "@/components/admin/rental/office-list";
import { ContractList } from "@/components/admin/rental/contract-list";
import { DealKanban } from "@/components/admin/rental/deal-kanban";

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

export default async function RentalManagerPage() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [offices, tenants, contracts, allContracts, expiringCount, newThisMonth, totalRevenue, inquiries, deals] =
    await Promise.all([
      prisma.office.findMany({
        orderBy: [{ building: "asc" }, { floor: "asc" }, { number: "asc" }],
        include: {
          contracts: {
            where: { status: { in: ["ACTIVE", "EXPIRING"] } },
            include: { tenant: { select: { id: true, companyName: true } } },
            take: 1,
          },
        },
      }),
      prisma.tenant.findMany({
        where: { isDeleted: false },
        orderBy: { companyName: "asc" },
        include: {
          _count: { select: { contracts: true } },
          contracts: {
            include: {
              office: {
                select: {
                  id: true, number: true, floor: true, building: true,
                  area: true, officeType: true,
                },
              },
            },
            orderBy: { endDate: "desc" },
          },
        },
      }),
      prisma.rentalContract.findMany({
        include: {
          tenant: { select: { companyName: true } },
          office: { select: { number: true, floor: true, building: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.rentalContract.findMany({
        where: { status: { in: ["ACTIVE", "EXPIRING"] } },
        select: { monthlyRate: true },
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
        include: { office: { select: { number: true, floor: true, building: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.rentalDeal.findMany({
        include: {
          office: { select: { id: true, number: true, floor: true, building: true, area: true, pricePerMonth: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      }),
    ]);

  const newInquiries = inquiries.filter((i) => !i.isRead).length;
  const monthlyRevenue = totalRevenue.reduce((sum, c) => sum + Number(c.monthlyRate), 0);
  const activeContracts = allContracts.length;
  const occupiedOffices = offices.filter((o) => o.status === "OCCUPIED").length;

  // Auto-update contract statuses in-memory
  const contractsForUI = contracts.map((c) => {
    let status = c.status;
    if (status === "ACTIVE" || status === "EXPIRING") {
      const endDate = new Date(c.endDate);
      if (endDate < now) status = "EXPIRED";
      else if (endDate < in30Days) status = "EXPIRING";
    }
    return {
      ...c,
      status,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
      pricePerSqm: c.pricePerSqm ? Number(c.pricePerSqm) : null,
      monthlyRate: Number(c.monthlyRate),
      newPricePerSqm: c.newPricePerSqm ? Number(c.newPricePerSqm) : null,
      priceIncreaseDate: c.priceIncreaseDate ? c.priceIncreaseDate.toISOString() : null,
      deposit: c.deposit ? Number(c.deposit) : null,
    };
  });

  // Occupancy by building
  const buildingStats = new Map<number, { total: number; occupied: number }>();
  for (const o of offices) {
    if (!buildingStats.has(o.building)) buildingStats.set(o.building, { total: 0, occupied: 0 });
    const s = buildingStats.get(o.building)!;
    s.total++;
    if (o.status === "OCCUPIED") s.occupied++;
  }

  // Expiring contracts list
  const expiringContracts = contractsForUI
    .filter((c) => c.status === "EXPIRING")
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
    .slice(0, 10);

  return (
    <>
      <AdminHeader title="Аренда — CRM" />
      <div className="p-6 lg:p-8">
        <RentalTabs>
          {{
            overview: (
              <div className="space-y-6">
                {/* === KPI Widgets === */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                  <StatusWidget
                    title="Помещений занято"
                    value={`${occupiedOffices} / ${offices.length}`}
                    status="info"
                    description={`${Math.round((occupiedOffices / (offices.length || 1)) * 100)}% занятость`}
                  />
                  <StatusWidget
                    title="Выручка/мес"
                    value={`${monthlyRevenue.toLocaleString("ru-RU")} ₽`}
                    status="success"
                    description={`${activeContracts} активных`}
                  />
                  <StatusWidget
                    title="Истекают (30 дн.)"
                    value={expiringCount}
                    status={expiringCount > 0 ? "warning" : "success"}
                  />
                  <StatusWidget
                    title="Новых/мес"
                    value={newThisMonth}
                    status="info"
                    description={now.toLocaleDateString("ru-RU", { month: "long" })}
                  />
                  <StatusWidget
                    title="Заявки"
                    value={newInquiries}
                    status={newInquiries > 0 ? "warning" : "success"}
                    description="непрочитанных"
                  />
                </div>

                {/* === Occupancy by Building === */}
                <Card>
                  <CardHeader>
                    <h2 className="font-semibold text-zinc-900">Заполняемость по корпусам</h2>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {Array.from(buildingStats.entries())
                        .sort(([a], [b]) => a - b)
                        .map(([building, s]) => {
                          const pct = s.total > 0 ? Math.round((s.occupied / s.total) * 100) : 0;
                          return (
                            <div key={building} className="rounded-lg border border-zinc-100 p-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-zinc-900">Корпус {building}</span>
                                <span className="text-sm text-zinc-500">{s.occupied}/{s.total}</span>
                              </div>
                              <div className="w-full h-3 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    pct > 80 ? "bg-green-500" : pct > 50 ? "bg-blue-500" : "bg-amber-500"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <p className="mt-1 text-xs text-zinc-400">{pct}% занято</p>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                </Card>

                {/* === Expiring Contracts Alert === */}
                {expiringContracts.length > 0 && (
                  <Card className="border-amber-200">
                    <CardHeader className="bg-amber-50/50">
                      <h2 className="font-semibold text-amber-900">
                        ⚠ Истекающие договоры
                        <span className="ml-2 text-sm font-normal text-amber-600">
                          ({expiringContracts.length})
                        </span>
                      </h2>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {expiringContracts.map((c) => {
                          const daysLeft = Math.ceil(
                            (new Date(c.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                          );
                          return (
                            <div
                              key={c.id}
                              className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50/50 text-sm"
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-medium text-zinc-900">
                                  К{c.office.building}·{c.office.number}
                                </span>
                                <span className="text-zinc-600">{c.tenant.companyName}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-zinc-500">
                                  {Number(c.monthlyRate).toLocaleString("ru-RU")} ₽/мес
                                </span>
                                <Badge variant={daysLeft <= 7 ? "danger" : "warning"}>
                                  {daysLeft} дн.
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* === Inquiries === */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-zinc-900">
                        Заявки на аренду
                        {newInquiries > 0 && (
                          <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                            {newInquiries}
                          </span>
                        )}
                      </h2>
                      <span className="text-sm text-zinc-500">{inquiries.length} всего</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {inquiries.length === 0 ? (
                      <p className="text-sm text-zinc-400">Заявок пока нет</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-zinc-100 text-left text-zinc-500">
                              <th className="pb-3 pr-3 font-medium">Дата</th>
                              <th className="pb-3 pr-3 font-medium">Имя</th>
                              <th className="pb-3 pr-3 font-medium">Телефон</th>
                              <th className="pb-3 pr-3 font-medium">Компания</th>
                              <th className="pb-3 pr-3 font-medium">Помещение</th>
                              <th className="pb-3 pr-3 font-medium">Статус</th>
                              <th className="pb-3 font-medium">Действия</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inquiries.slice(0, 10).map((inq) => (
                              <tr
                                key={inq.id}
                                className={`border-b border-zinc-50 ${!inq.isRead ? "bg-blue-50/50" : ""}`}
                              >
                                <td className="py-3 pr-3 text-zinc-500 whitespace-nowrap text-xs">
                                  {new Date(inq.createdAt).toLocaleDateString("ru-RU", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </td>
                                <td className="py-3 pr-3 font-medium text-zinc-900">
                                  {!inq.isRead && (
                                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2" />
                                  )}
                                  {inq.name}
                                </td>
                                <td className="py-3 pr-3">
                                  <a href={`tel:${inq.phone}`} className="text-blue-600 hover:underline">
                                    {inq.phone}
                                  </a>
                                </td>
                                <td className="py-3 pr-3 text-zinc-600">{inq.companyName || "—"}</td>
                                <td className="py-3 pr-3 text-zinc-600">
                                  {inq.office
                                    ? `К${inq.office.building}·${inq.office.number} (${inq.office.floor} эт.)`
                                    : "Общий"}
                                </td>
                                <td className="py-3 pr-3">
                                  <Badge variant={inquiryStatusVariant[inq.status]}>
                                    {inquiryStatusLabel[inq.status]}
                                  </Badge>
                                </td>
                                <td className="py-3">
                                  <InquiryActions
                                    inquiryId={inq.id}
                                    currentStatus={inq.status}
                                    isRead={inq.isRead}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* === Financial Summary === */}
                <Card>
                  <CardHeader>
                    <h2 className="font-semibold text-zinc-900">
                      Финансы — {now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
                    </h2>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div className="rounded-lg bg-zinc-50 p-4">
                        <p className="text-zinc-500 text-xs">Выручка (прогноз)</p>
                        <p className="text-xl font-bold text-zinc-900 mt-1">
                          {monthlyRevenue.toLocaleString("ru-RU")} ₽
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-4">
                        <p className="text-zinc-500 text-xs">Занятость</p>
                        <p className="text-xl font-bold text-zinc-900 mt-1">
                          {Math.round((occupiedOffices / (offices.length || 1)) * 100)}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-4">
                        <p className="text-zinc-500 text-xs">Активных договоров</p>
                        <p className="text-xl font-bold text-zinc-900 mt-1">{activeContracts}</p>
                      </div>
                      <div className="rounded-lg bg-zinc-50 p-4">
                        <p className="text-zinc-500 text-xs">Истекают скоро</p>
                        <p
                          className={`text-xl font-bold mt-1 ${
                            expiringCount > 0 ? "text-amber-600" : "text-zinc-900"
                          }`}
                        >
                          {expiringCount}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ),

            pipeline: (
              <DealKanban
                now={now.getTime()}
                initialDeals={deals.map((d) => ({
                  ...d,
                  dealValue: d.dealValue ? Number(d.dealValue) : null,
                  moveInDate: d.moveInDate ? d.moveInDate.toISOString() : null,
                  nextActionDate: d.nextActionDate ? d.nextActionDate.toISOString() : null,
                  createdAt: d.createdAt.toISOString(),
                  updatedAt: d.updatedAt.toISOString(),
                  office: d.office
                    ? {
                        ...d.office,
                        area: Number(d.office.area),
                        pricePerMonth: Number(d.office.pricePerMonth),
                      }
                    : null,
                }))}
                offices={offices.map((o) => ({
                  id: o.id,
                  number: o.number,
                  floor: o.floor,
                  building: o.building,
                  area: Number(o.area),
                  pricePerMonth: Number(o.pricePerMonth),
                  status: o.status,
                }))}
              />
            ),

            tenants: (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-zinc-900">Арендаторы</h2>
                    <span className="text-sm text-zinc-500">{tenants.length} всего</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <TenantList
                    tenants={tenants.map((t) => ({
                      ...t,
                      phonesExtra: t.phonesExtra as string[] | null,
                      emailsExtra: t.emailsExtra as string[] | null,
                      contracts: t.contracts.map((c) => ({
                        id: c.id,
                        status: c.status,
                        startDate: c.startDate.toISOString(),
                        endDate: c.endDate.toISOString(),
                        pricePerSqm: c.pricePerSqm ? Number(c.pricePerSqm) : null,
                        monthlyRate: Number(c.monthlyRate),
                        documentUrl: c.documentUrl,
                        office: {
                          id: c.office.id,
                          number: c.office.number,
                          floor: c.office.floor,
                          building: c.office.building,
                          area: Number(c.office.area),
                          officeType: c.office.officeType,
                        },
                      })),
                    }))}
                  />
                </CardContent>
              </Card>
            ),

            offices: (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-zinc-900">Помещения</h2>
                    <span className="text-sm text-zinc-500">{offices.length} всего</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <OfficeList
                    offices={offices.map((o) => ({
                      ...o,
                      area: Number(o.area),
                      pricePerMonth: Number(o.pricePerMonth),
                    }))}
                  />
                </CardContent>
              </Card>
            ),

            contracts: (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-zinc-900">Договоры</h2>
                    <span className="text-sm text-zinc-500">{contracts.length} всего</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ContractList contracts={contractsForUI} />
                </CardContent>
              </Card>
            ),
          }}
        </RentalTabs>
      </div>
    </>
  );
}
