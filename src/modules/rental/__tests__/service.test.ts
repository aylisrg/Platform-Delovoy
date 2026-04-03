import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    office: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    rentalContract: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import {
  listOffices,
  getOffice,
  createOffice,
  updateOffice,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  listContracts,
  createContract,
  updateContract,
  getExpiringContracts,
  getMonthlyReport,
  RentalError,
} from "@/modules/rental/service";
import { prisma } from "@/lib/db";

const mockOffice = (overrides = {}) => ({
  id: "office-1",
  number: "301",
  floor: 3,
  area: 50,
  pricePerMonth: 30000,
  status: "AVAILABLE",
  metadata: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

const mockTenant = (overrides = {}) => ({
  id: "tenant-1",
  companyName: "ООО Тест",
  contactName: "Иванов Иван",
  email: "test@test.ru",
  phone: "+79001234567",
  inn: "1234567890",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

const mockContract = (overrides = {}) => ({
  id: "contract-1",
  tenantId: "tenant-1",
  officeId: "office-1",
  startDate: new Date("2025-01-01"),
  endDate: new Date("2026-12-31"),
  monthlyRate: 30000,
  deposit: 60000,
  status: "ACTIVE",
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
  it("returns all offices ordered by floor and number", async () => {
    const offices = [mockOffice(), mockOffice({ id: "office-2", number: "302" })];
    vi.mocked(prisma.office.findMany).mockResolvedValue(offices);

    const result = await listOffices();

    expect(result).toEqual(offices);
    expect(prisma.office.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ floor: "asc" }, { number: "asc" }],
    });
  });

  it("filters by status", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([mockOffice()]);

    await listOffices({ status: "AVAILABLE" });

    expect(prisma.office.findMany).toHaveBeenCalledWith({
      where: { status: "AVAILABLE" },
      orderBy: [{ floor: "asc" }, { number: "asc" }],
    });
  });

  it("filters by floor", async () => {
    vi.mocked(prisma.office.findMany).mockResolvedValue([]);

    await listOffices({ floor: 3 });

    expect(prisma.office.findMany).toHaveBeenCalledWith({
      where: { floor: 3 },
      orderBy: [{ floor: "asc" }, { number: "asc" }],
    });
  });
});

describe("getOffice", () => {
  it("returns office by id", async () => {
    const office = mockOffice();
    vi.mocked(prisma.office.findUnique).mockResolvedValue(office);

    const result = await getOffice("office-1");

    expect(result).toEqual(office);
    expect(prisma.office.findUnique).toHaveBeenCalledWith({ where: { id: "office-1" } });
  });

  it("returns null for non-existent office", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);

    const result = await getOffice("non-existent");

    expect(result).toBeNull();
  });
});

describe("createOffice", () => {
  it("creates office with valid input", async () => {
    const office = mockOffice();
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.office.create).mockResolvedValue(office);

    const result = await createOffice({
      number: "301",
      floor: 3,
      area: 50,
      pricePerMonth: 30000,
    });

    expect(result).toEqual(office);
    expect(prisma.office.create).toHaveBeenCalled();
  });

  it("throws if office number already exists", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice());

    await expect(
      createOffice({ number: "301", floor: 3, area: 50, pricePerMonth: 30000 })
    ).rejects.toThrow(RentalError);
  });
});

describe("updateOffice", () => {
  it("updates existing office", async () => {
    const office = mockOffice();
    const updated = mockOffice({ pricePerMonth: 35000 });
    vi.mocked(prisma.office.findUnique).mockResolvedValue(office);
    vi.mocked(prisma.office.update).mockResolvedValue(updated);

    const result = await updateOffice("office-1", { pricePerMonth: 35000 });

    expect(result.pricePerMonth).toBe(35000);
  });

  it("throws if office not found", async () => {
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);

    await expect(updateOffice("non-existent", { floor: 2 })).rejects.toThrow(RentalError);
  });

  it("throws if new number already taken", async () => {
    vi.mocked(prisma.office.findUnique)
      .mockResolvedValueOnce(mockOffice())
      .mockResolvedValueOnce(mockOffice({ id: "office-2", number: "302" }));

    await expect(
      updateOffice("office-1", { number: "302" })
    ).rejects.toThrow(RentalError);
  });
});

// === TENANTS ===

describe("listTenants", () => {
  it("returns all tenants ordered by company name", async () => {
    const tenants = [mockTenant()];
    vi.mocked(prisma.tenant.findMany).mockResolvedValue(tenants);

    const result = await listTenants();

    expect(result).toEqual(tenants);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith({
      orderBy: { companyName: "asc" },
    });
  });
});

describe("getTenant", () => {
  it("returns tenant with contracts", async () => {
    const tenant = { ...mockTenant(), contracts: [mockContract()] };
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(tenant as never);

    const result = await getTenant("tenant-1");

    expect(result).toEqual(tenant);
  });
});

describe("createTenant", () => {
  it("creates tenant with valid input", async () => {
    const tenant = mockTenant();
    vi.mocked(prisma.tenant.create).mockResolvedValue(tenant);

    const result = await createTenant({
      companyName: "ООО Тест",
      contactName: "Иванов Иван",
      email: "test@test.ru",
    });

    expect(result).toEqual(tenant);
  });
});

describe("updateTenant", () => {
  it("updates existing tenant", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant());
    vi.mocked(prisma.tenant.update).mockResolvedValue(
      mockTenant({ companyName: "ООО Новое" })
    );

    const result = await updateTenant("tenant-1", { companyName: "ООО Новое" });

    expect(result.companyName).toBe("ООО Новое");
  });

  it("throws if tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    await expect(
      updateTenant("non-existent", { companyName: "Тест" })
    ).rejects.toThrow(RentalError);
  });
});

// === CONTRACTS ===

describe("listContracts", () => {
  it("returns contracts with relations", async () => {
    const contracts = [
      {
        ...mockContract(),
        tenant: mockTenant(),
        office: mockOffice(),
      },
    ];
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue(contracts as never);

    const result = await listContracts();

    expect(result).toHaveLength(1);
  });

  it("auto-updates EXPIRED status for past contracts", async () => {
    const pastContract = {
      ...mockContract({
        status: "ACTIVE",
        endDate: new Date("2020-01-01"),
      }),
      tenant: mockTenant(),
      office: mockOffice(),
    };
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([pastContract] as never);

    const result = await listContracts();

    expect(result[0].status).toBe("EXPIRED");
  });

  it("auto-updates EXPIRING status for soon-ending contracts", async () => {
    const soonEndDate = new Date();
    soonEndDate.setDate(soonEndDate.getDate() + 15);

    const soonContract = {
      ...mockContract({
        status: "ACTIVE",
        endDate: soonEndDate,
      }),
      tenant: mockTenant(),
      office: mockOffice(),
    };
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([soonContract] as never);

    const result = await listContracts();

    expect(result[0].status).toBe("EXPIRING");
  });

  it("filters by status", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([]);

    await listContracts({ status: "ACTIVE" });

    expect(prisma.rentalContract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });
});

describe("createContract", () => {
  it("creates contract when office is free", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant());
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice());
    vi.mocked(prisma.rentalContract.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.rentalContract.create).mockResolvedValue({
      ...mockContract(),
      tenant: mockTenant(),
      office: mockOffice(),
    } as never);
    vi.mocked(prisma.office.update).mockResolvedValue(mockOffice({ status: "OCCUPIED" }));

    const result = await createContract({
      tenantId: "tenant-1",
      officeId: "office-1",
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      monthlyRate: 30000,
    });

    expect(result).toBeDefined();
    expect(prisma.rentalContract.create).toHaveBeenCalled();
  });

  it("throws if tenant not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice());

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

  it("throws if office not found", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant());
    vi.mocked(prisma.office.findUnique).mockResolvedValue(null);

    await expect(
      createContract({
        tenantId: "tenant-1",
        officeId: "non-existent",
        startDate: "2025-01-01",
        endDate: "2026-12-31",
        monthlyRate: 30000,
      })
    ).rejects.toThrow(RentalError);
  });

  it("throws if office is already occupied", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant());
    vi.mocked(prisma.office.findUnique).mockResolvedValue(mockOffice());
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
    vi.mocked(prisma.office.update).mockResolvedValue(mockOffice());

    const result = await updateContract("contract-1", { status: "TERMINATED" });

    expect(result).toBeDefined();
    expect(prisma.office.update).toHaveBeenCalledWith({
      where: { id: "office-1" },
      data: { status: "AVAILABLE" },
    });
  });

  it("throws if contract not found", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(null);

    await expect(
      updateContract("non-existent", { status: "TERMINATED" })
    ).rejects.toThrow(RentalError);
  });

  it("throws on invalid status transition", async () => {
    vi.mocked(prisma.rentalContract.findUnique).mockResolvedValue(
      mockContract({ status: "EXPIRED" }) as never
    );

    await expect(
      updateContract("contract-1", { status: "ACTIVE" })
    ).rejects.toThrow(RentalError);
  });
});

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

describe("getMonthlyReport", () => {
  it("returns report with correct metrics", async () => {
    vi.mocked(prisma.rentalContract.findMany).mockResolvedValue([
      mockContract({ monthlyRate: 30000 }) as never,
      mockContract({ id: "c-2", monthlyRate: 50000 }) as never,
    ]);
    vi.mocked(prisma.office.count)
      .mockResolvedValueOnce(20)   // totalOffices
      .mockResolvedValueOnce(10);  // occupiedOffices
    vi.mocked(prisma.rentalContract.count)
      .mockResolvedValueOnce(2)    // newContracts
      .mockResolvedValueOnce(1)    // terminatedContracts
      .mockResolvedValueOnce(3);   // expiringContracts

    const report = await getMonthlyReport(2025, 6);

    expect(report.year).toBe(2025);
    expect(report.month).toBe(6);
    expect(report.totalRevenue).toBe(80000);
    expect(report.activeContracts).toBe(2);
    expect(report.totalOffices).toBe(20);
    expect(report.occupiedOffices).toBe(10);
    expect(report.occupancyRate).toBe(50);
    expect(report.newContracts).toBe(2);
    expect(report.terminatedContracts).toBe(1);
    expect(report.expiringContracts).toBe(3);
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
