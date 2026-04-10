import { prisma } from "@/lib/db";
import type { ContractStatus, OfficeStatus } from "@prisma/client";
import { enqueueNotification } from "@/modules/notifications/queue";
import type {
  CreateOfficeInput,
  UpdateOfficeInput,
  OfficeFilter,
  CreateTenantInput,
  UpdateTenantInput,
  CreateContractInput,
  UpdateContractInput,
  ContractFilter,
  MonthlyReport,
  CreateInquiryInput,
  UpdateInquiryInput,
  InquiryFilter,
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

// === OFFICES ===

export async function listOffices(filter?: OfficeFilter) {
  return prisma.office.findMany({
    where: {
      ...(filter?.status && { status: filter.status }),
      ...(filter?.floor && { floor: filter.floor }),
    },
    orderBy: [{ floor: "asc" }, { number: "asc" }],
  });
}

export async function getOffice(id: string) {
  return prisma.office.findUnique({ where: { id } });
}

export async function createOffice(input: CreateOfficeInput) {
  const existing = await prisma.office.findUnique({ where: { number: input.number } });
  if (existing) {
    throw new RentalError("OFFICE_NUMBER_EXISTS", `Офис с номером ${input.number} уже существует`);
  }

  return prisma.office.create({
    data: {
      number: input.number,
      floor: input.floor,
      area: input.area,
      pricePerMonth: input.pricePerMonth,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    },
  });
}

export async function updateOffice(id: string, input: UpdateOfficeInput) {
  const office = await prisma.office.findUnique({ where: { id } });
  if (!office) {
    throw new RentalError("OFFICE_NOT_FOUND", "Офис не найден");
  }

  if (input.number && input.number !== office.number) {
    const existing = await prisma.office.findUnique({ where: { number: input.number } });
    if (existing) {
      throw new RentalError("OFFICE_NUMBER_EXISTS", `Офис с номером ${input.number} уже существует`);
    }
  }

  return prisma.office.update({
    where: { id },
    data: {
      ...(input.number !== undefined && { number: input.number }),
      ...(input.floor !== undefined && { floor: input.floor }),
      ...(input.area !== undefined && { area: input.area }),
      ...(input.pricePerMonth !== undefined && { pricePerMonth: input.pricePerMonth }),
      ...(input.status !== undefined && { status: input.status as OfficeStatus }),
      ...(input.metadata !== undefined && {
        metadata: JSON.parse(JSON.stringify(input.metadata)),
      }),
    },
  });
}

// === TENANTS ===

export async function listTenants() {
  return prisma.tenant.findMany({
    orderBy: { companyName: "asc" },
  });
}

export async function getTenant(id: string) {
  return prisma.tenant.findUnique({
    where: { id },
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
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      inn: input.inn,
    },
  });
}

export async function updateTenant(id: string, input: UpdateTenantInput) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  }

  return prisma.tenant.update({
    where: { id },
    data: {
      ...(input.companyName !== undefined && { companyName: input.companyName }),
      ...(input.contactName !== undefined && { contactName: input.contactName }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.inn !== undefined && { inn: input.inn }),
    },
  });
}

// === CONTRACTS ===

export async function listContracts(filter?: ContractFilter) {
  const contracts = await prisma.rentalContract.findMany({
    where: {
      ...(filter?.tenantId && { tenantId: filter.tenantId }),
      ...(filter?.officeId && { officeId: filter.officeId }),
      ...(filter?.status && { status: filter.status }),
    },
    include: {
      tenant: true,
      office: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Auto-update statuses in-memory
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return contracts.map((c) => {
    if (c.status === "ACTIVE" || c.status === "EXPIRING") {
      if (c.endDate < now) return { ...c, status: "EXPIRED" as ContractStatus };
      if (c.endDate < in30Days) return { ...c, status: "EXPIRING" as ContractStatus };
    }
    return c;
  });
}

export async function getContract(id: string) {
  const contract = await prisma.rentalContract.findUnique({
    where: { id },
    include: { tenant: true, office: true },
  });

  if (!contract) return null;

  // Auto-update status in-memory
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
    prisma.tenant.findUnique({ where: { id: input.tenantId } }),
    prisma.office.findUnique({ where: { id: input.officeId } }),
  ]);

  if (!tenant) throw new RentalError("TENANT_NOT_FOUND", "Арендатор не найден");
  if (!office) throw new RentalError("OFFICE_NOT_FOUND", "Офис не найден");

  // Check office is not already occupied by an active contract
  const activeContract = await prisma.rentalContract.findFirst({
    where: {
      officeId: input.officeId,
      status: { in: ["ACTIVE", "EXPIRING"] },
    },
  });

  if (activeContract) {
    throw new RentalError("OFFICE_OCCUPIED", "У этого офиса уже есть действующий договор аренды");
  }

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let status: ContractStatus = "DRAFT";
  if (startDate <= now) {
    if (endDate < now) status = "EXPIRED";
    else if (endDate < in30Days) status = "EXPIRING";
    else status = "ACTIVE";
  }

  const contract = await prisma.rentalContract.create({
    data: {
      tenantId: input.tenantId,
      officeId: input.officeId,
      startDate,
      endDate,
      monthlyRate: input.monthlyRate,
      deposit: input.deposit,
      status,
      documentUrl: input.documentUrl,
      notes: input.notes,
    },
    include: { tenant: true, office: true },
  });

  // Mark office as occupied if contract is active
  if (status === "ACTIVE" || status === "EXPIRING") {
    await prisma.office.update({
      where: { id: input.officeId },
      data: { status: "OCCUPIED" },
    });
  }

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

  // Validate status transitions
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
      ...(input.endDate !== undefined && { endDate: new Date(input.endDate) }),
      ...(input.monthlyRate !== undefined && { monthlyRate: input.monthlyRate }),
      ...(input.deposit !== undefined && { deposit: input.deposit }),
      ...(input.status !== undefined && { status: input.status as ContractStatus }),
      ...(input.documentUrl !== undefined && { documentUrl: input.documentUrl }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
    include: { tenant: true, office: true },
  });

  // Sync office status
  if (input.status === "TERMINATED" || input.status === "EXPIRED") {
    await prisma.office.update({
      where: { id: contract.officeId },
      data: { status: "AVAILABLE" },
    });
  } else if (input.status === "ACTIVE" || input.status === "EXPIRING") {
    await prisma.office.update({
      where: { id: contract.officeId },
      data: { status: "OCCUPIED" },
    });
  }

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

// === MONTHLY REPORT ===

export async function getMonthlyReport(year: number, month: number): Promise<MonthlyReport> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    allContracts,
    totalOffices,
    newContracts,
    terminatedContracts,
    expiringContracts,
  ] = await Promise.all([
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

  const totalRevenue = allContracts.reduce(
    (sum, c) => sum + Number(c.monthlyRate),
    0
  );
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
