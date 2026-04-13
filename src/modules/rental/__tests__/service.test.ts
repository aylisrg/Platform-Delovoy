import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/queue", () => ({
  enqueueNotification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    office: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
    },
    rentalContract: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    rentalInquiry: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  listOffices,
  getOffice,
  createOffice,
  updateOffice,
  deleteOffice,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantContracts,
  listContracts,
  createContract,
  updateContract,
  renewContract,
  terminateContract,
  getExpiringContracts,
  getMonthlyReport,
  getOccupancyReport,
  RentalError,
} from "@/modules/rental/service";
import { prisma } from "@/lib/db";

const mockOffice = (overrides = {}) => ({
  id: "office-1",
  number: "9",
  floor: 2,
  building: 3,
  officeType: "OFFICE" as const,
  area: 41.3,
  pricePerMonth: 52038,
  hasWetPoint: false,
  hasToilet: false,
  hasRoofAccess: false,
  status: "AVAILABLE" as const,
  metadata: null,
  comment: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

const mockTenant = (overrides = {}) => ({
  id: "tenant-1",
  companyName: "ООО «МК ОРИОН-СЕРВИС»",
  tenantType: "COMPANY" as const,
  contactName: "Павел",
  phone: "79168469325",
  phonesExtra: null,
  email: "il85@list.ru",
  emailsExtra: null,
  inn: "7727563401",
  legalAddress: null,
  needsLegalAddress: false,
  notes: null,
  isDeleted: false,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

const mockContract = (overrides = {}) => ({
  id: "contract-1",
  tenantId: "tenant-1",
  officeId: "office-1",
  startDate: new Date("2025-01-01"),
  endDate: new Date("2027-12-31"),
  pricePerSqm: 1260,
  monthlyRate: 52038,
  currency: "RUB",
  newPricePerSqm: null,
  priceIncreaseDate: null,
  deposit: null,
  contractNumber: "Д-2025/001",
  status: "ACTIVE" as const,
  documentUrl: null,
  notes: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// === OFFICES ===

describe("listOffices", () => {
  it("returns all offices ordered by building, floor, number", async () => {
    const offices = [mockOffice()];
    vi.mocked(prisma.office.findMany).mockResolvedValue(offices as never);

    const result = await listOffices();

    expect(result).toEqual(offices);
    expect(prisma.office.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ building: "asc" }, { floor: "asc" }, { number: "asc" }],
      })
    );
  });

  it("filters by building", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([]);

    await listOffices({ building: 3 });

    expect(prisma.office.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ building: 3 }),
      })
    );
  });

  it("filters by office type", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([]);

    await listOffices({ type: "CONTAINER" });

    expect(prisma.office.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ officeType: "CONTAINER" }),
      })
    );
  });
});

describe("createOffice", () => {
  it("creates office with building", async () => {
    const office = mockOffice();
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.office.create).mockResolvedValue(office as never);

    const result = await createOffice({
      number: "9",
      floor: 2,
      building: 3,
      area: 41.3,
      pricePerMonth: 52038,
    });

    expect(result).toEqual(office);
    expect(prisma.office.create).toHaveBeenCalled();
  });

  it("throws if office number already exists in same building/floor", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);

    await expect(
      createOffice({ number: "9", floor: 2, building: 3, area: 50, pricePerMonth: 30000 })
    ).rejects.toThrow(RentalError);
  });
});

describe("updateOffice", () => {
  it("updates existing office", async () => {
    const office = mockOffice();
    const updated = mockOffice({ hasWetPoint: true });
    vi.mocked(prisma.office.findUnique)
      .mockResolvedValueOnce(office as never)
      .mockResolvedValueOnce(null); // uniqueness check
    vi.mocked(prisma.office.update).mockResolvedValue(updated as never);

    const result = await updateOffice("office-1", { hasWetPoint: true });

    expect(result.hasWetPoint).toBe(true);
  });

  it("throws if office not found", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);

    await expect(updateOffice("non-existent", { floor: 2 })).rejects.toThrow(RentalError);
  });
});

describe("deleteOffice", () => {
  it("deletes office without active contracts", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(0);
    vi.mocked(prisma.office.delete).mockResolvedValue(mockOffice() as never);

    await deleteOffice("office-1");

    expect(prisma.office.delete).toHaveBeenCalledWith({ where: { id: "office-1" } });
  });

  it("throws if office has active contracts", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(1);

    await expect(deleteOffice("office-1")).rejects.toThrow(RentalError);
  });

  it("throws if office not found", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);

    await expect(deleteOffice("non-existent")).rejects.toThrow(RentalError);
  });
});

// === TENANTS ===

describe("listTenants", () => {
  it("returns paginated tenants", async () => {
    const tenants = [mockTenant()];
    vi.mocked(prisma.tenant.findMany).mockResolvedValue(tenants as never);
    vi.mocked(prisma.tenant.count).mockResolvedValue(1);

    const result = await listTenants({ page: 1, limit: 20 });

    expect(result.tenants).toEqual(tenants);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters by search term", async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tenant.count).mockResolvedValue(0);

    await listTenants({ search: "ОРИОН", page: 1, limit: 20 });

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeleted: false,
          OR: expect.arrayContaining([
            expect.objectContaining({ companyName: { contains: "ОРИОН", mode: "insensitive" } }),
          ]),
        }),
      })
    );
  });

  it("filters by tenant type", async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tenant.count).mockResolvedValue(0);

    await listTenants({ type: "COMPANY", page: 1, limit: 20 });

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantType: "COMPANY" }),
      })
    );
  });
});

describe("createTenant", () => {
  it("creates tenant with new fields", async () => {
    const tenant = mockTenant();
    vi.mocked(prisma.tenant.create).mockResolvedValue(tenant as never);

    const result = await createTenant({
      companyName: "ООО «МК ОРИОН-СЕРВИС»",
      tenantType: "COMPANY",
      contactName: "Павел",
      phone: "79168469325",
      needsLegalAddress: true,
    });

    expect(result).toEqual(tenant);
    expect(prisma.tenant.create).toHaveBeenCalled();
  });
});

describe("deleteTenant", () => {
  it("soft deletes tenant without active contracts", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant() as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(0);
    vi.mocked(prisma.tenant.update).mockResolvedValue(mockTenant({ isDeleted: true }) as never);

    const result = await deleteTenant("tenant-1");

    expect(result.isDeleted).toBe(true);
  });

  it("throws if tenant has active contracts", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant() as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(2);

    await expect(deleteTenant("tenant-1")).rejects.toThrow(RentalError);
  });

  it("throws if tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    await expect(deleteTenant("non-existent")).rejects.toThrow(RentalError);
  });
});

describe("getTenantContracts", () => {
  it("returns contracts for existing tenant", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant() as never);
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([mockContract()] as never);

    const result = await getTenantContracts("tenant-1");

    expect(result).toHaveLength(1);
  });

  it("throws if tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    await expect(getTenantContracts("non-existent")).rejects.toThrow(RentalError);
  });
});

// === CONTRACTS ===

describe("listContracts", () => {
  it("returns paginated contracts with relations", async () => {
    const contracts = [{ ...mockContract(), tenant: mockTenant(), office: mockOffice() }];
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue(contracts as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(1);

    const result = await listContracts();

    expect(result.contracts).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("auto-updates EXPIRED status for past contracts", async () => {
    const pastContract = {
      ...mockContract({ status: "ACTIVE", endDate: new Date("2020-01-01") }),
      tenant: mockTenant(),
      office: mockOffice(),
    };
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([pastContract] as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(1);

    const result = await listContracts();

    expect(result.contracts[0].status).toBe("EXPIRED");
  });

  it("auto-updates EXPIRING status for soon-ending contracts", async () => {
    const soonEndDate = new Date();
    soonEndDate.setDate(soonEndDate.getDate() + 15);

    const soonContract = {
      ...mockContract({ status: "ACTIVE", endDate: soonEndDate }),
      tenant: mockTenant(),
      office: mockOffice(),
    };
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([soonContract] as never);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(1);

    const result = await listContracts();

    expect(result.contracts[0].status).toBe("EXPIRING");
  });

  it("filters by array of statuses", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([]);
    vi.mocked(prisma.rentalContract.count).mockResolvedValue(0);

    await listContracts({ status: ["ACTIVE", "EXPIRING"] });

    expect(prisma.rentalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["ACTIVE", "EXPIRING"] } }),
      })
    );
  });
});

describe("createContract", () => {
  it("creates contract when office is free", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant() as never);
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);
    vi.mocked(prisma.rentalContract.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.rentalContract.create).mockResolvedValue({
      ...mockContract(),
      tenant: mockTenant(),
      office: mockOffice(),
    } as never);
    vi.mocked(prisma.office.update).mockResolvedValue(mockOffice({ status: "OCCUPIED" }) as never);

    const result = await createContract({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2027-12-31",
      pricePerSqm: 1260,
      monthlyRate: 52038,
      contractNumber: "Д-2025/001",
    });

    expect(result).toBeDefined();
    expect(prisma.rentalContract.create).toHaveBeenCalled();
  });

  it("throws if tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);

    await expect(
      createContract({
        tenantId: "non-existent",
        officeId: "office-1",
        startDate: "2025-01-01",
        endDate: "2026-12-31",
        monthlyRate: 30000,
      })
    ).rejects.toThrow(RentalError);
  });

  it("throws if office is already occupied", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant() as never);
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice() as never);
    vi.mocked(prisma.rentalContract.findFirst).mockResolvedValue(mockContract() as never);

    await expect(
      createContract({
        tenantId: "tenant-1",
        officeId: "office-1",
        startDate: "2025-01-01",
        endDate: "2026-12-31",
        monthlyRate: 30000,
      })
    ).rejects.toThrow(RentalError);
  });
});

describe("updateContract", () => {
  it("updates contract with valid status transition", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(mockContract() as never);
    vi.mocked(prisma.rentalContract.update).mockResolvedValue({
      ...mockContract({ status: "TERMINATED" }),
      tenant: mockTenant(),
      office: mockOffice(),
    } as never);
    vi.mocked(prisma.office.update).mockResolvedValue(mockOffice() as never);

    const result = await updateContract("contract-1", { status: "TERMINATED" });

    expect(result).toBeDefined();
    expect(prisma.office.update).toHaveBeenCalledWith({
      where: { id: "office-1" },
      data: { status: "AVAILABLE" },
    });
  });

  it("throws on invalid status transition", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(
      mockContract({ status: "EXPIRED" }) as never
    );

    await expect(
      updateContract("contract-1", { status: "ACTIVE" })
    ).rejects.toThrow(RentalError);
  });

  it("throws if contract not found", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(null);

    await expect(
      updateContract("non-existent", { status: "TERMINATED" })
    ).rejects.toThrow(RentalError);
  });
});

describe("renewContract", () => {
  it("renews active contract with new end date", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue({
      ...mockContract(),
      office: mockOffice(),
    } as never);
    vi.mocked(prisma.rentalContract.update).mockResolvedValue({
      ...mockContract({ endDate: new Date("2028-12-31"), status: "ACTIVE" }),
      tenant: mockTenant(),
      office: mockOffice(),
    } as never);

    const result = await renewContract("contract-1", { newEndDate: "2028-12-31" });

    expect(result).toBeDefined();
    expect(prisma.rentalContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("throws if contract is not active", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue({
      ...mockContract({ status: "EXPIRED" }),
      office: mockOffice(),
    } as never);

    await expect(
      renewContract("contract-1", { newEndDate: "2028-12-31" })
    ).rejects.toThrow(RentalError);
  });

  it("throws if new end date is not later", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue({
      ...mockContract(),
      office: mockOffice(),
    } as never);

    await expect(
      renewContract("contract-1", { newEndDate: "2025-01-01" })
    ).rejects.toThrow(RentalError);
  });

  it("throws if contract not found", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(null);

    await expect(
      renewContract("non-existent", { newEndDate: "2028-12-31" })
    ).rejects.toThrow(RentalError);
  });
});

describe("terminateContract", () => {
  it("terminates active contract and frees office", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(mockContract() as never);
    vi.mocked(prisma.rentalContract.update).mockResolvedValue({
      ...mockContract({ status: "TERMINATED" }),
      tenant: mockTenant(),
      office: mockOffice(),
    } as never);
    vi.mocked(prisma.office.update).mockResolvedValue(mockOffice() as never);

    const result = await terminateContract("contract-1", "Неоплата");

    expect(result.status).toBe("TERMINATED");
    expect(prisma.office.update).toHaveBeenCalledWith({
      where: { id: "office-1" },
      data: { status: "AVAILABLE" },
    });
  });

  it("throws if already terminated", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(
      mockContract({ status: "TERMINATED" }) as never
    );

    await expect(terminateContract("contract-1")).rejects.toThrow(RentalError);
  });
});

// === EXPIRING CONTRACTS ===

describe("getExpiringContracts", () => {
  it("returns contracts expiring within specified days", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([]);

    await getExpiringContracts(30);

    expect(prisma.rentalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["ACTIVE", "EXPIRING"] },
        }),
      })
    );
  });
});

// === REPORTS ===

describe("getMonthlyReport", () => {
  it("returns report with correct metrics", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([
      mockContract({ monthlyRate: 30000 }) as never,
      mockContract({ id: "c-2", monthlyRate: 50000 }) as never,
    ]);
    vi.mocked(prisma.office.count)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(10);
    vi.mocked(prisma.rentalContract.count)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);

    const report = await getMonthlyReport(2025, 6);

    expect(report.totalRevenue).toBe(80000);
    expect(report.activeContracts).toBe(2);
    expect(report.occupancyRate).toBe(50);
  });

  it("returns 0 occupancy rate when no offices", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([]);
    vi.mocked(prisma.office.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.rentalContract.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const report = await getMonthlyReport(2025, 1);

    expect(report.occupancyRate).toBe(0);
  });
});

describe("getOccupancyReport", () => {
  it("groups offices by building", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([
      { building: 1, status: "OCCUPIED" },
      { building: 1, status: "AVAILABLE" },
      { building: 2, status: "OCCUPIED" },
      { building: 2, status: "OCCUPIED" },
      { building: 2, status: "MAINTENANCE" },
    ] as never);

    const report = await getOccupancyReport();

    expect(report).toHaveLength(2);
    expect(report[0].building).toBe(1);
    expect(report[0].total).toBe(2);
    expect(report[0].occupied).toBe(1);
    expect(report[0].occupancyRate).toBe(50);
    expect(report[1].building).toBe(2);
    expect(report[1].total).toBe(3);
    expect(report[1].occupied).toBe(2);
    expect(report[1].maintenance).toBe(1);
  });
});
