import { prisma } from "@/lib/db";
import type { ContractStatus, OfficeStatus, Prisma } from "@prisma/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import {
  generatePaymentsForContract,
  regeneratePendingPayments,
  autoResolveTasksForContract,
} from "./payments";
import type {
  CreateOfficeInput,
  UpdateOfficeInput,
  OfficeFilter,
  CreateTenantInput,
  UpdateTenantInput,
  TenantFilter,
  CreateContractInput,
  UpdateContractInput,
  ContractFilter,
  RenewContractInput,
  MonthlyReport,
  OccupancyReport,
  ImportResult,
  CreateInquiryInput,
  UpdateInquiryInput,
  InquiryFilter,
  CreateDealInput,
  UpdateDealInput,
  DealFilter,
  ReorderDealInput,
} from "./types";

// === ERROR ===

export class RentalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RentalError";
  }
}

// === TENANTS ===

export async function listTenants(filter?: TenantFilter) {
  const page = filter?.page ?? 1;
  const limit = filter?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Prisma.TenantWhereInput = {
    isDeleted: false,
    ...(filter?.type && { tenantType: filter.type }),
  };

  if (filter?.search) {
    const search = filter.search;
    where.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { contactName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { companyName: "asc" },
      skip,
      take: limit,
      include: { _count: { select: { contracts: true } } },
    }),
    prisma.tenant.count({ where }),
  ]);

  return { tenants, total, page, limit };
}

export async function getTenant(id: string) {
  return prisma.tenant.findUnique({
    where: { id, isDeleted: false },
    include: {
      contracts: {
        include: { office: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function createTenant(input: CreateTenantInput) {
  return prisma.tenant.create({
    data: {
      companyName: input.companyName,
      tenantType: input.tenantType,
      contactName: input.contactName,
      phone: input.phone,
      phonesExtra: input.phonesExtra ?? undefined,
      email: input.email,
      emailsExtra: input.emailsExtra ?? undefined,
      inn: input.inn,
      legalAddress: input.legalAddress,
      needsLegalAddress: input.needsLegalAddress,
      notes: input.notes,
    },
  });
}

export async function updateTenant(id: string, input: UpdateTenantInput) {
  const tenant = await prisma.tenant.findUnique({ where: { id, isDeleted: false } });
  if (!tenant) {
    throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  }

  return prisma.tenant.update({
    where: { id },
    data: {
      ...(input.companyName !== undefined && { companyName: input.companyName }),
      ...(input.tenantType !== undefined && { tenantType: input.tenantType }),
      ...(input.contactName !== undefined && { contactName: input.contactName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.phonesExtra !== undefined && { phonesExtra: input.phonesExtra }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.emailsExtra !== undefined && { emailsExtra: input.emailsExtra }),
      ...(input.inn !== undefined && { inn: input.inn }),
      ...(input.legalAddress !== undefined && { legalAddress: input.legalAddress }),
      ...(input.needsLegalAddress !== undefined && { needsLegalAddress: input.needsLegalAddress }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  });
}

export async function deleteTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id, isDeleted: false } });
  if (!tenant) {
    throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  }

  const activeContracts = await prisma.rentalContract.count({
    where: { tenantId: id, status: { in: ["ACTIVE", "EXPIRING"] } },
  });
  if (activeContracts > 0) {
    throw new RentalError("TENANT_HAS_ACTIVE_CONTRACTS", "Нельзя удалить арендатора с активными договорами");
  }

  return prisma.tenant.update({
    where: { id },
    data: { isDeleted: true },
  });
}

export async function getTenantContracts(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId, isDeleted: false } });
  if (!tenant) {
    throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  }

  return prisma.rentalContract.findMany({
    where: { tenantId },
    include: { office: true },
    orderBy: { createdAt: "desc" },
  });
}

// === OFFICES ===

export async function listOffices(filter?: OfficeFilter) {
  return prisma.office.findMany({
    where: {
      ...(filter?.status && { status: filter.status }),
      ...(filter?.floor && { floor: filter.floor }),
      ...(filter?.building && { building: filter.building }),
      ...(filter?.type && { officeType: filter.type }),
    },
    orderBy: [{ building: "asc" }, { floor: "asc" }, { number: "asc" }],
    include: {
      contracts: {
        where: { status: { in: ["ACTIVE", "EXPIRING"] } },
        include: { tenant: { select: { id: true, companyName: true } } },
        take: 1,
      },
    },
  });
}

export async function getOffice(id: string) {
  return prisma.office.findUnique({
    where: { id },
    include: {
      contracts: {
        include: { tenant: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
}

export async function createOffice(input: CreateOfficeInput) {
  const existing = await prisma.office.findUnique({
    where: {
      building_floor_number: {
        building: input.building,
        floor: input.floor,
        number: input.number,
      },
    },
  });
  if (existing) {
    throw new RentalError(
      "OFFICE_NUMBER_EXISTS",
      `Помещение ${input.number} (корп. ${input.building}, этаж ${input.floor}) уже существует`
    );
  }

  return prisma.office.create({
    data: {
      number: input.number,
      floor: input.floor,
      building: input.building,
      officeType: input.officeType,
      area: input.area,
      pricePerMonth: input.pricePerMonth,
      hasWetPoint: input.hasWetPoint,
      hasToilet: input.hasToilet,
      hasRoofAccess: input.hasRoofAccess,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
      comment: input.comment,
    },
  });
}

export async function updateOffice(id: string, input: UpdateOfficeInput) {
  const office = await prisma.office.findUnique({ where: { id } });
  if (!office) {
    throw new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено");
  }

  // Check uniqueness if number/floor/building changed
  const newNumber = input.number ?? office.number;
  const newFloor = input.floor ?? office.floor;
  const newBuilding = input.building ?? office.building;

  if (newNumber !== office.number || newFloor !== office.floor || newBuilding !== office.building) {
    const existing = await prisma.office.findUnique({
      where: { building_floor_number: { building: newBuilding, floor: newFloor, number: newNumber } },
    });
    if (existing && existing.id !== id) {
      throw new RentalError(
        "OFFICE_NUMBER_EXISTS",
        `Помещение ${newNumber} (корп. ${newBuilding}, этаж ${newFloor}) уже существует`
      );
    }
  }

  return prisma.office.update({
    where: { id },
    data: {
      ...(input.number !== undefined && { number: input.number }),
      ...(input.floor !== undefined && { floor: input.floor }),
      ...(input.building !== undefined && { building: input.building }),
      ...(input.officeType !== undefined && { officeType: input.officeType }),
      ...(input.area !== undefined && { area: input.area }),
      ...(input.pricePerMonth !== undefined && { pricePerMonth: input.pricePerMonth }),
      ...(input.hasWetPoint !== undefined && { hasWetPoint: input.hasWetPoint }),
      ...(input.hasToilet !== undefined && { hasToilet: input.hasToilet }),
      ...(input.hasRoofAccess !== undefined && { hasRoofAccess: input.hasRoofAccess }),
      ...(input.status !== undefined && { status: input.status as OfficeStatus }),
      ...(input.metadata !== undefined && { metadata: JSON.parse(JSON.stringify(input.metadata)) }),
      ...(input.comment !== undefined && { comment: input.comment }),
    },
  });
}

export async function deleteOffice(id: string) {
  const office = await prisma.office.findUnique({ where: { id } });
  if (!office) {
    throw new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено");
  }

  const activeContracts = await prisma.rentalContract.count({
    where: { officeId: id, status: { in: ["ACTIVE", "EXPIRING"] } },
  });
  if (activeContracts > 0) {
    throw new RentalError("OFFICE_HAS_ACTIVE_CONTRACTS", "Нельзя удалить помещение с активными договорами");
  }

  return prisma.office.delete({ where: { id } });
}

// === CONTRACTS ===

function autoContractStatus(startDate: Date, endDate: Date): ContractStatus {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (endDate < now) return "EXPIRED";
  if (startDate > now) return "DRAFT";
  if (endDate < in30Days) return "EXPIRING";
  return "ACTIVE";
}

export async function listContracts(filter?: ContractFilter) {
  const page = filter?.page ?? 1;
  const limit = filter?.limit ?? 20;
  const skip = (page - 1) * limit;

  const statusFilter = filter?.status
    ? Array.isArray(filter.status)
      ? { in: filter.status }
      : filter.status
    : undefined;

  const where: Prisma.RentalContractWhereInput = {
    ...(statusFilter && { status: statusFilter }),
    ...(filter?.tenantId && { tenantId: filter.tenantId }),
    ...(filter?.officeId && { officeId: filter.officeId }),
  };

  const [contracts, total] = await Promise.all([
    prisma.rentalContract.findMany({
      where,
      include: { tenant: true, office: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.rentalContract.count({ where }),
  ]);

  // Auto-update statuses in-memory
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const mapped = contracts.map((c) => {
    if (c.status === "ACTIVE" || c.status === "EXPIRING") {
      if (c.endDate < now) return { ...c, status: "EXPIRED" as ContractStatus };
      if (c.endDate < in30Days) return { ...c, status: "EXPIRING" as ContractStatus };
    }
    return c;
  });

  return { contracts: mapped, total, page, limit };
}

export async function getContract(id: string) {
  const contract = await prisma.rentalContract.findUnique({
    where: { id },
    include: { tenant: true, office: true },
  });

  if (!contract) return null;

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (contract.status === "ACTIVE" || contract.status === "EXPIRING") {
    if (contract.endDate < now) return { ...contract, status: "EXPIRED" as ContractStatus };
    if (contract.endDate < in30Days) return { ...contract, status: "EXPIRING" as ContractStatus };
  }

  return contract;
}

export async function createContract(input: CreateContractInput) {
  const [tenant, office] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: input.tenantId, isDeleted: false } }),
    prisma.office.findUnique({ where: { id: input.officeId } }),
  ]);

  if (!tenant) throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  if (!office) throw new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено");

  const activeContract = await prisma.rentalContract.findFirst({
    where: {
      officeId: input.officeId,
      status: { in: ["ACTIVE", "EXPIRING"] },
    },
  });

  if (activeContract) {
    throw new RentalError("OFFICE_OCCUPIED", "У этого помещения уже есть действующий договор аренды");
  }

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const status = autoContractStatus(startDate, endDate);

  const contract = await prisma.rentalContract.create({
    data: {
      tenantId: input.tenantId,
      officeId: input.officeId,
      startDate,
      endDate,
      pricePerSqm: input.pricePerSqm,
      monthlyRate: input.monthlyRate,
      currency: input.currency ?? "RUB",
      deposit: input.deposit,
      contractNumber: input.contractNumber,
      status,
      documentUrl: input.documentUrl,
      notes: input.notes,
    },
    include: { tenant: true, office: true },
  });

  if (status === "ACTIVE" || status === "EXPIRING") {
    await prisma.office.update({
      where: { id: input.officeId },
      data: { status: "OCCUPIED" },
    });
  }

  await generatePaymentsForContract(contract);

  enqueueNotification({
    type: "contract.created",
    moduleSlug: "rental",
    entityId: contract.id,
    data: {
      tenantName: tenant.companyName,
      officeNumber: office.number,
      monthlyRate: input.monthlyRate.toString(),
      startDate: input.startDate,
      endDate: input.endDate,
    },
  });

  return contract;
}

export async function updateContract(id: string, input: UpdateContractInput) {
  const contract = await prisma.rentalContract.findUnique({ where: { id } });
  if (!contract) {
    throw new RentalError("CONTRACT_NOT_FOUND", "Договор не найден");
  }

  if (input.status) {
    const validTransitions: Record<ContractStatus, ContractStatus[]> = {
      DRAFT: ["ACTIVE", "TERMINATED"],
      ACTIVE: ["EXPIRING", "TERMINATED"],
      EXPIRING: ["ACTIVE", "EXPIRED", "TERMINATED"],
      EXPIRED: [],
      TERMINATED: [],
    };

    if (!validTransitions[contract.status].includes(input.status as ContractStatus)) {
      throw new RentalError(
        "INVALID_STATUS_TRANSITION",
        `Нельзя перевести договор из статуса ${contract.status} в ${input.status}`
      );
    }
  }

  const updated = await prisma.rentalContract.update({
    where: { id },
    data: {
      ...(input.startDate !== undefined && { startDate: new Date(input.startDate) }),
      ...(input.endDate !== undefined && { endDate: new Date(input.endDate) }),
      ...(input.pricePerSqm !== undefined && { pricePerSqm: input.pricePerSqm }),
      ...(input.monthlyRate !== undefined && { monthlyRate: input.monthlyRate }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.newPricePerSqm !== undefined && { newPricePerSqm: input.newPricePerSqm }),
      ...(input.priceIncreaseDate !== undefined && { priceIncreaseDate: new Date(input.priceIncreaseDate) }),
      ...(input.deposit !== undefined && { deposit: input.deposit }),
      ...(input.contractNumber !== undefined && { contractNumber: input.contractNumber }),
      ...(input.status !== undefined && { status: input.status as ContractStatus }),
      ...(input.documentUrl !== undefined && { documentUrl: input.documentUrl }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    include: { tenant: true, office: true },
  });

  if (input.status === "TERMINATED" || input.status === "EXPIRED") {
    await prisma.office.update({
      where: { id: contract.officeId },
      data: { status: "AVAILABLE" },
    });
    await autoResolveTasksForContract(id);
  } else if (input.status === "ACTIVE" || input.status === "EXPIRING") {
    await prisma.office.update({
      where: { id: contract.officeId },
      data: { status: "OCCUPIED" },
    });
  }

  const affectsSchedule =
    input.monthlyRate !== undefined ||
    input.endDate !== undefined ||
    input.startDate !== undefined;
  if (affectsSchedule && updated.status !== "TERMINATED" && updated.status !== "EXPIRED") {
    await regeneratePendingPayments(id);
  }

  return updated;
}

export async function renewContract(id: string, input: RenewContractInput) {
  const contract = await prisma.rentalContract.findUnique({
    where: { id },
    include: { office: true },
  });
  if (!contract) {
    throw new RentalError("CONTRACT_NOT_FOUND", "Договор не найден");
  }
  if (!["ACTIVE", "EXPIRING"].includes(contract.status)) {
    throw new RentalError("INVALID_STATUS_TRANSITION", "Продлить можно только активный или истекающий договор");
  }

  const newEndDate = new Date(input.newEndDate);
  if (newEndDate <= contract.endDate) {
    throw new RentalError("INVALID_DATE", "Новая дата окончания должна быть позже текущей");
  }

  const data: Prisma.RentalContractUpdateInput = {
    endDate: newEndDate,
    status: "ACTIVE",
  };

  if (input.newPricePerSqm) {
    data.newPricePerSqm = input.newPricePerSqm;
    data.priceIncreaseDate = contract.endDate;
    if (contract.office) {
      data.monthlyRate = input.newPricePerSqm * Number(contract.office.area);
    }
  }

  const renewed = await prisma.rentalContract.update({
    where: { id },
    data,
    include: { tenant: true, office: true },
  });

  await generatePaymentsForContract(renewed);

  return renewed;
}

export async function terminateContract(id: string, reason?: string) {
  const contract = await prisma.rentalContract.findUnique({ where: { id } });
  if (!contract) {
    throw new RentalError("CONTRACT_NOT_FOUND", "Договор не найден");
  }
  if (["EXPIRED", "TERMINATED"].includes(contract.status)) {
    throw new RentalError("INVALID_STATUS_TRANSITION", "Договор уже завершён или расторгнут");
  }

  const updated = await prisma.rentalContract.update({
    where: { id },
    data: {
      status: "TERMINATED",
      notes: reason ? `${contract.notes ? contract.notes + "\n" : ""}Причина расторжения: ${reason}` : contract.notes,
    },
    include: { tenant: true, office: true },
  });

  await prisma.office.update({
    where: { id: contract.officeId },
    data: { status: "AVAILABLE" },
  });

  await autoResolveTasksForContract(id);

  return updated;
}

// === EXPIRING CONTRACTS ===

export async function getExpiringContracts(daysAhead = 30) {
  const now = new Date();
  const deadline = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return prisma.rentalContract.findMany({
    where: {
      status: { in: ["ACTIVE", "EXPIRING"] },
      endDate: { gte: now, lte: deadline },
    },
    include: { tenant: true, office: true },
    orderBy: { endDate: "asc" },
  });
}

// === REPORTS ===

export async function getRevenueReport(building?: number): Promise<MonthlyReport> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const officeWhere = building ? { building } : {};

  const [allContracts, totalOffices, newContracts, terminatedContracts, expiringContracts] =
    await Promise.all([
      prisma.rentalContract.findMany({
        where: {
          status: { in: ["ACTIVE", "EXPIRING"] },
          ...(building && { office: { building } }),
        },
      }),
      prisma.office.count({ where: officeWhere }),
      prisma.rentalContract.count({
        where: {
          startDate: { gte: monthStart, lte: monthEnd },
          ...(building && { office: { building } }),
        },
      }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["TERMINATED", "EXPIRED"] },
          updatedAt: { gte: monthStart, lte: monthEnd },
          ...(building && { office: { building } }),
        },
      }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["ACTIVE", "EXPIRING"] },
          endDate: { gte: now, lte: in30Days },
          ...(building && { office: { building } }),
        },
      }),
    ]);

  const totalRevenue = allContracts.reduce((sum, c) => sum + Number(c.monthlyRate), 0);
  const occupiedOffices = await prisma.office.count({
    where: { ...officeWhere, status: "OCCUPIED" },
  });

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    totalRevenue,
    activeContracts: allContracts.length,
    occupiedOffices,
    totalOffices,
    occupancyRate: totalOffices > 0 ? Math.round((occupiedOffices / totalOffices) * 100) : 0,
    newContracts,
    terminatedContracts,
    expiringContracts,
  };
}

export async function getMonthlyReport(year: number, month: number): Promise<MonthlyReport> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [allContracts, totalOffices, newContracts, terminatedContracts, expiringContracts] =
    await Promise.all([
      prisma.rentalContract.findMany({
        where: { status: { in: ["ACTIVE", "EXPIRING"] } },
      }),
      prisma.office.count(),
      prisma.rentalContract.count({
        where: { startDate: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["TERMINATED", "EXPIRED"] },
          updatedAt: { gte: monthStart, lte: monthEnd },
        },
      }),
      prisma.rentalContract.count({
        where: {
          status: { in: ["ACTIVE", "EXPIRING"] },
          endDate: { gte: now, lte: in30Days },
        },
      }),
    ]);

  const totalRevenue = allContracts.reduce((sum, c) => sum + Number(c.monthlyRate), 0);
  const occupiedOffices = await prisma.office.count({ where: { status: "OCCUPIED" } });

  return {
    year,
    month,
    totalRevenue,
    activeContracts: allContracts.length,
    occupiedOffices,
    totalOffices,
    occupancyRate: totalOffices > 0 ? Math.round((occupiedOffices / totalOffices) * 100) : 0,
    newContracts,
    terminatedContracts,
    expiringContracts,
  };
}

export async function getOccupancyReport(): Promise<OccupancyReport[]> {
  const offices = await prisma.office.findMany({
    select: { building: true, status: true },
  });

  const buildingMap = new Map<number, { total: number; occupied: number; available: number; maintenance: number; reserved: number }>();

  for (const office of offices) {
    if (!buildingMap.has(office.building)) {
      buildingMap.set(office.building, { total: 0, occupied: 0, available: 0, maintenance: 0, reserved: 0 });
    }
    const stats = buildingMap.get(office.building)!;
    stats.total++;
    if (office.status === "OCCUPIED") stats.occupied++;
    else if (office.status === "AVAILABLE") stats.available++;
    else if (office.status === "MAINTENANCE") stats.maintenance++;
    else if (office.status === "RESERVED") stats.reserved++;
  }

  return Array.from(buildingMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([building, stats]) => ({
      building,
      ...stats,
      occupancyRate: stats.total > 0 ? Math.round((stats.occupied / stats.total) * 100) : 0,
    }));
}

// === IMPORT ===

interface ImportTenant {
  companyName: string;
  tenantType?: string;
  contactName?: string;
  phone?: string;
  phonesExtra?: string[];
  email?: string;
  emailsExtra?: string[];
  inn?: string;
  legalAddress?: string;
  needsLegalAddress?: boolean;
  notes?: string;
}

interface ImportOffice {
  number: string;
  floor: number;
  building: number;
  officeType?: string;
  area: number;
  pricePerMonth?: number;
  hasWetPoint?: boolean;
  hasToilet?: boolean;
  hasRoofAccess?: boolean;
  comment?: string;
}

interface ImportContract {
  tenantRef: string; // companyName to match
  officeRef: string; // "building-floor-number" to match
  startDate: string;
  endDate: string;
  pricePerSqm?: number;
  monthlyRate: number;
  currency?: string;
  deposit?: number;
  contractNumber?: string;
  newPricePerSqm?: number;
  priceIncreaseDate?: string;
  notes?: string;
}

interface ImportData {
  tenants: ImportTenant[];
  offices: ImportOffice[];
  contracts: ImportContract[];
}

export async function importFromJson(data: ImportData): Promise<ImportResult> {
  const result: ImportResult = { tenants: 0, offices: 0, contracts: 0, errors: [] };
  const tenantMap = new Map<string, string>(); // companyName → id
  const officeMap = new Map<string, string>(); // "building-floor-number" → id

  // Import tenants
  for (const t of data.tenants) {
    try {
      const tenant = await prisma.tenant.upsert({
        where: {
          id: (await prisma.tenant.findFirst({ where: { companyName: t.companyName } }))?.id ?? "nonexistent",
        },
        update: {
          tenantType: (t.tenantType as "COMPANY" | "IP" | "INDIVIDUAL") ?? "INDIVIDUAL",
          contactName: t.contactName,
          phone: t.phone,
          phonesExtra: t.phonesExtra ?? undefined,
          email: t.email,
          emailsExtra: t.emailsExtra ?? undefined,
          inn: t.inn,
          legalAddress: t.legalAddress,
          needsLegalAddress: t.needsLegalAddress ?? false,
          notes: t.notes,
        },
        create: {
          companyName: t.companyName,
          tenantType: (t.tenantType as "COMPANY" | "IP" | "INDIVIDUAL") ?? "INDIVIDUAL",
          contactName: t.contactName,
          phone: t.phone,
          phonesExtra: t.phonesExtra ?? undefined,
          email: t.email,
          emailsExtra: t.emailsExtra ?? undefined,
          inn: t.inn,
          legalAddress: t.legalAddress,
          needsLegalAddress: t.needsLegalAddress ?? false,
          notes: t.notes,
        },
      });
      tenantMap.set(t.companyName, tenant.id);
      result.tenants++;
    } catch (err) {
      result.errors.push(`Tenant "${t.companyName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Import offices
  for (const o of data.offices) {
    try {
      const office = await prisma.office.upsert({
        where: {
          building_floor_number: { building: o.building, floor: o.floor, number: o.number },
        },
        update: {
          officeType: (o.officeType as "OFFICE" | "CONTAINER" | "MEETING_ROOM") ?? "OFFICE",
          area: o.area,
          pricePerMonth: o.pricePerMonth ?? 0,
          hasWetPoint: o.hasWetPoint ?? false,
          hasToilet: o.hasToilet ?? false,
          hasRoofAccess: o.hasRoofAccess ?? false,
          comment: o.comment,
        },
        create: {
          number: o.number,
          floor: o.floor,
          building: o.building,
          officeType: (o.officeType as "OFFICE" | "CONTAINER" | "MEETING_ROOM") ?? "OFFICE",
          area: o.area,
          pricePerMonth: o.pricePerMonth ?? 0,
          hasWetPoint: o.hasWetPoint ?? false,
          hasToilet: o.hasToilet ?? false,
          hasRoofAccess: o.hasRoofAccess ?? false,
          comment: o.comment,
        },
      });
      officeMap.set(`${o.building}-${o.floor}-${o.number}`, office.id);
      result.offices++;
    } catch (err) {
      result.errors.push(`Office ${o.building}-${o.floor}-${o.number}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Import contracts
  for (const c of data.contracts) {
    try {
      const tenantId = tenantMap.get(c.tenantRef);
      if (!tenantId) {
        result.errors.push(`Contract: арендатор "${c.tenantRef}" не найден`);
        continue;
      }

      const officeId = officeMap.get(c.officeRef);
      if (!officeId) {
        result.errors.push(`Contract: помещение "${c.officeRef}" не найдено`);
        continue;
      }

      const startDate = new Date(c.startDate);
      const endDate = new Date(c.endDate);
      const status = autoContractStatus(startDate, endDate);

      await prisma.rentalContract.create({
        data: {
          tenantId,
          officeId,
          startDate,
          endDate,
          pricePerSqm: c.pricePerSqm,
          monthlyRate: c.monthlyRate,
          currency: c.currency ?? "RUB",
          deposit: c.deposit,
          contractNumber: c.contractNumber,
          newPricePerSqm: c.newPricePerSqm,
          priceIncreaseDate: c.priceIncreaseDate ? new Date(c.priceIncreaseDate) : undefined,
          status,
          notes: c.notes,
        },
      });

      // Sync office status
      if (status === "ACTIVE" || status === "EXPIRING") {
        await prisma.office.update({
          where: { id: officeId },
          data: { status: "OCCUPIED" },
        });
      }

      result.contracts++;
    } catch (err) {
      result.errors.push(`Contract ${c.tenantRef} → ${c.officeRef}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// === INQUIRIES ===

export async function listInquiries(filter?: InquiryFilter) {
  return prisma.rentalInquiry.findMany({
    where: {
      ...(filter?.status && { status: filter.status }),
      ...(filter?.isRead !== undefined && { isRead: filter.isRead }),
    },
    include: { office: { select: { id: true, number: true, floor: true, building: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getInquiry(id: string) {
  const inquiry = await prisma.rentalInquiry.findUnique({
    where: { id },
    include: { office: true },
  });
  if (!inquiry) throw new RentalError("INQUIRY_NOT_FOUND", "Заявка не найдена");
  return inquiry;
}

export async function createInquiry(input: CreateInquiryInput) {
  // Resolve officeIds: use officeIds array if provided, fallback to single officeId
  const resolvedOfficeIds = input.officeIds?.length
    ? input.officeIds
    : input.officeId
      ? [input.officeId]
      : [];

  // Validate all office IDs exist
  let officeNumbers: string[] = [];
  if (resolvedOfficeIds.length > 0) {
    const offices = await prisma.office.findMany({
      where: { id: { in: resolvedOfficeIds } },
      select: { id: true, number: true },
    });
    if (offices.length !== resolvedOfficeIds.length) {
      throw new RentalError("OFFICE_NOT_FOUND", "Одно или несколько помещений не найдено");
    }
    officeNumbers = offices.map((o) => o.number);
  }

  // Build message with selected offices info
  let finalMessage = input.message || "";
  if (resolvedOfficeIds.length > 1) {
    const officeList = officeNumbers.map((n) => `№${n}`).join(", ");
    const prefix = `Интересующие офисы: ${officeList}`;
    finalMessage = finalMessage ? `${prefix}\n\n${finalMessage}` : prefix;
  }

  const inquiry = await prisma.rentalInquiry.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      companyName: input.companyName,
      message: finalMessage || undefined,
      officeId: resolvedOfficeIds[0] || undefined,
    },
    include: { office: { select: { number: true } } },
  });

  // Auto-create deal in NEW_LEAD stage
  const deal = await prisma.rentalDeal.create({
    data: {
      contactName: input.name,
      phone: input.phone,
      email: input.email,
      companyName: input.companyName,
      stage: "NEW_LEAD",
      priority: "WARM",
      source: "WEBSITE",
      requirements: input.message,
      officeId: resolvedOfficeIds[0] || undefined,
      inquiryId: inquiry.id,
      adminNotes: `Автоматически создано из заявки на сайте`,
    },
  });

  enqueueNotification({
    type: "inquiry.created",
    moduleSlug: "rental",
    entityId: inquiry.id,
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email || "—",
      companyName: input.companyName || "—",
      message: finalMessage || "—",
      officeNumber: officeNumbers.length > 0 ? officeNumbers.join(", ") : "Общий запрос",
    },
  });

  // Also notify admin about new deal in pipeline
  enqueueNotification({
    type: "deal.created",
    moduleSlug: "rental",
    entityId: deal.id,
    data: {
      contactName: input.name,
      phone: input.phone,
      companyName: input.companyName || "—",
      stage: "NEW_LEAD",
    },
  });

  return inquiry;
}

const VALID_INQUIRY_TRANSITIONS: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["CONVERTED", "CLOSED"],
  CONVERTED: [],
  CLOSED: [],
};

export async function updateInquiry(id: string, input: UpdateInquiryInput) {
  const inquiry = await prisma.rentalInquiry.findUnique({ where: { id } });
  if (!inquiry) throw new RentalError("INQUIRY_NOT_FOUND", "Заявка не найдена");

  if (input.status && !VALID_INQUIRY_TRANSITIONS[inquiry.status]?.includes(input.status)) {
    throw new RentalError("INVALID_STATUS_TRANSITION", `Нельзя перевести из ${inquiry.status} в ${input.status}`);
  }

  return prisma.rentalInquiry.update({
    where: { id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.isRead !== undefined && { isRead: input.isRead }),
      ...(input.adminNotes !== undefined && { adminNotes: input.adminNotes }),
      ...(input.convertedToId !== undefined && { convertedToId: input.convertedToId }),
    },
    include: { office: { select: { id: true, number: true, floor: true, building: true } } },
  });
}

// === DEALS (Sales Pipeline) ===

export async function listDeals(filter?: DealFilter) {
  const where: Prisma.RentalDealWhereInput = {};

  if (filter?.stage) {
    where.stage = Array.isArray(filter.stage) ? { in: filter.stage } : filter.stage;
  }
  if (filter?.priority) where.priority = filter.priority;
  if (filter?.source) where.source = filter.source;

  return prisma.rentalDeal.findMany({
    where,
    include: {
      office: { select: { id: true, number: true, floor: true, building: true, area: true, pricePerMonth: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
}

export async function getDeal(id: string) {
  const deal = await prisma.rentalDeal.findUnique({
    where: { id },
    include: {
      office: { select: { id: true, number: true, floor: true, building: true, area: true, pricePerMonth: true } },
    },
  });
  if (!deal) throw new RentalError("DEAL_NOT_FOUND", "Сделка не найдена");
  return deal;
}

export async function createDeal(input: CreateDealInput) {
  if (input.officeId) {
    const office = await prisma.office.findUnique({ where: { id: input.officeId } });
    if (!office) throw new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено");
  }

  const maxSort = await prisma.rentalDeal.aggregate({
    where: { stage: input.stage ?? "NEW_LEAD" },
    _max: { sortOrder: true },
  });

  return prisma.rentalDeal.create({
    data: {
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      companyName: input.companyName,
      stage: input.stage,
      priority: input.priority,
      source: input.source,
      desiredArea: input.desiredArea,
      budget: input.budget,
      moveInDate: input.moveInDate ? new Date(input.moveInDate) : undefined,
      requirements: input.requirements,
      officeId: input.officeId,
      inquiryId: input.inquiryId,
      dealValue: input.dealValue,
      nextActionDate: input.nextActionDate ? new Date(input.nextActionDate) : undefined,
      nextAction: input.nextAction,
      adminNotes: input.adminNotes,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
    include: {
      office: { select: { id: true, number: true, floor: true, building: true, area: true, pricePerMonth: true } },
    },
  });
}

export async function updateDeal(id: string, input: UpdateDealInput) {
  const deal = await prisma.rentalDeal.findUnique({ where: { id } });
  if (!deal) throw new RentalError("DEAL_NOT_FOUND", "Сделка не найдена");

  if (input.officeId) {
    const office = await prisma.office.findUnique({ where: { id: input.officeId } });
    if (!office) throw new RentalError("OFFICE_NOT_FOUND", "Помещение не найдено");
  }

  return prisma.rentalDeal.update({
    where: { id },
    data: {
      ...(input.contactName !== undefined && { contactName: input.contactName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.companyName !== undefined && { companyName: input.companyName }),
      ...(input.stage !== undefined && { stage: input.stage }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.source !== undefined && { source: input.source }),
      ...(input.desiredArea !== undefined && { desiredArea: input.desiredArea }),
      ...(input.budget !== undefined && { budget: input.budget }),
      ...(input.moveInDate !== undefined && { moveInDate: input.moveInDate ? new Date(input.moveInDate) : null }),
      ...(input.requirements !== undefined && { requirements: input.requirements }),
      ...(input.officeId !== undefined && { officeId: input.officeId || null }),
      ...(input.inquiryId !== undefined && { inquiryId: input.inquiryId }),
      ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
      ...(input.contractId !== undefined && { contractId: input.contractId }),
      ...(input.dealValue !== undefined && { dealValue: input.dealValue }),
      ...(input.nextActionDate !== undefined && { nextActionDate: input.nextActionDate ? new Date(input.nextActionDate) : null }),
      ...(input.nextAction !== undefined && { nextAction: input.nextAction }),
      ...(input.lostReason !== undefined && { lostReason: input.lostReason }),
      ...(input.adminNotes !== undefined && { adminNotes: input.adminNotes }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
    include: {
      office: { select: { id: true, number: true, floor: true, building: true, area: true, pricePerMonth: true } },
    },
  });
}

export async function deleteDeal(id: string) {
  const deal = await prisma.rentalDeal.findUnique({ where: { id } });
  if (!deal) throw new RentalError("DEAL_NOT_FOUND", "Сделка не найдена");
  return prisma.rentalDeal.delete({ where: { id } });
}

export async function reorderDeals(updates: ReorderDealInput[]) {
  const txOps = updates.map((u) =>
    prisma.rentalDeal.update({
      where: { id: u.dealId },
      data: { stage: u.newStage, sortOrder: u.sortOrder },
    })
  );
  return prisma.$transaction(txOps);
}
