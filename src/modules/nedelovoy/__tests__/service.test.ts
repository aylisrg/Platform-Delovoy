import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/rental/service", () => ({
  RentalError: class RentalError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  listOffices: vi.fn(),
  getOffice: vi.fn(),
  createOffice: vi.fn(),
  updateOffice: vi.fn(),
  deleteOffice: vi.fn(),
  listTenants: vi.fn(),
  getTenant: vi.fn(),
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
  deleteTenant: vi.fn(),
  listContracts: vi.fn(),
  getContract: vi.fn(),
  createContract: vi.fn(),
  updateContract: vi.fn(),
  terminateContract: vi.fn(),
  getExpiringContracts: vi.fn(),
  listInquiries: vi.fn(),
  createInquiry: vi.fn(),
  updateInquiry: vi.fn(),
  listDeals: vi.fn(),
  getDeal: vi.fn(),
  createDeal: vi.fn(),
  updateDeal: vi.fn(),
  deleteDeal: vi.fn(),
  reorderDeals: vi.fn(),
  getMonthlyReport: vi.fn(),
  getRevenueReport: vi.fn(),
  getOccupancyReport: vi.fn(),
  importFromJson: vi.fn(),
}));

import * as rentalService from "@/modules/rental/service";
import * as nedelovoyService from "@/modules/nedelovoy/service";

beforeEach(() => vi.clearAllMocks());

describe("nedelovoy service — parkSlug pre-fill", () => {
  it("listOffices passes parkSlug=nedelovoy to rental service", async () => {
    vi.mocked(rentalService.listOffices).mockResolvedValue([]);
    await nedelovoyService.listOffices();
    expect(rentalService.listOffices).toHaveBeenCalledWith(
      expect.objectContaining({ parkSlug: "nedelovoy" })
    );
  });

  it("listOffices merges caller filter with parkSlug=nedelovoy", async () => {
    vi.mocked(rentalService.listOffices).mockResolvedValue([]);
    await nedelovoyService.listOffices({ status: "AVAILABLE" } as never);
    expect(rentalService.listOffices).toHaveBeenCalledWith(
      expect.objectContaining({ parkSlug: "nedelovoy", status: "AVAILABLE" })
    );
  });

  it("createOffice injects parkSlug=nedelovoy", async () => {
    vi.mocked(rentalService.createOffice).mockResolvedValue({} as never);
    await nedelovoyService.createOffice({ number: "201" } as never);
    expect(rentalService.createOffice).toHaveBeenCalledWith(
      expect.objectContaining({ parkSlug: "nedelovoy", number: "201" })
    );
  });

  it("listContracts passes parkSlug=nedelovoy to rental service", async () => {
    vi.mocked(rentalService.listContracts).mockResolvedValue({ contracts: [], total: 0, page: 1, limit: 50 });
    await nedelovoyService.listContracts();
    expect(rentalService.listContracts).toHaveBeenCalledWith(
      expect.objectContaining({ parkSlug: "nedelovoy" })
    );
  });

  it("createInquiry injects parkSlug=nedelovoy", async () => {
    vi.mocked(rentalService.createInquiry).mockResolvedValue({} as never);
    await nedelovoyService.createInquiry({ name: "Test", phone: "+7 000" } as never);
    expect(rentalService.createInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ parkSlug: "nedelovoy" })
    );
  });

  it("getExpiringContracts passes nedelovoy as parkSlug", async () => {
    vi.mocked(rentalService.getExpiringContracts).mockResolvedValue([]);
    await nedelovoyService.getExpiringContracts(30);
    expect(rentalService.getExpiringContracts).toHaveBeenCalledWith(30, "nedelovoy");
  });

  it("getOccupancyReport passes nedelovoy as parkSlug", async () => {
    vi.mocked(rentalService.getOccupancyReport).mockResolvedValue([]);
    await nedelovoyService.getOccupancyReport();
    expect(rentalService.getOccupancyReport).toHaveBeenCalledWith("nedelovoy");
  });
});
