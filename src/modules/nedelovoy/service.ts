import * as rentalService from "@/modules/rental/service";

export { RentalError } from "@/modules/rental/service";

const PARK = "nedelovoy" as const;

type OfficeFilter = Parameters<typeof rentalService.listOffices>[0];
type CreateOfficeInput = Parameters<typeof rentalService.createOffice>[0];
type UpdateOfficeInput = Parameters<typeof rentalService.updateOffice>[1];
type TenantFilter = Parameters<typeof rentalService.listTenants>[0];
type CreateTenantInput = Parameters<typeof rentalService.createTenant>[0];
type UpdateTenantInput = Parameters<typeof rentalService.updateTenant>[1];
type ContractFilter = Parameters<typeof rentalService.listContracts>[0];
type CreateContractInput = Parameters<typeof rentalService.createContract>[0];
type UpdateContractInput = Parameters<typeof rentalService.updateContract>[1];
type InquiryFilter = Parameters<typeof rentalService.listInquiries>[0];
type CreateInquiryInput = Parameters<typeof rentalService.createInquiry>[0];
type UpdateInquiryInput = Parameters<typeof rentalService.updateInquiry>[1];
type DealFilter = Parameters<typeof rentalService.listDeals>[0];
type CreateDealInput = Parameters<typeof rentalService.createDeal>[0];
type UpdateDealInput = Parameters<typeof rentalService.updateDeal>[1];
type ReorderDealInput = Parameters<typeof rentalService.reorderDeals>[0][number];
type ImportData = Parameters<typeof rentalService.importFromJson>[0];

// === OFFICES ===

export const listOffices = (filter?: OfficeFilter) =>
  rentalService.listOffices({ ...filter, parkSlug: PARK });

export const getOffice = (id: string) => rentalService.getOffice(id);

export const createOffice = (input: CreateOfficeInput) =>
  rentalService.createOffice({ ...input, parkSlug: PARK });

export const updateOffice = (id: string, input: UpdateOfficeInput) =>
  rentalService.updateOffice(id, input);

export const deleteOffice = (id: string) => rentalService.deleteOffice(id);

// === TENANTS ===

export const listTenants = (filter?: TenantFilter) => rentalService.listTenants(filter);
export const getTenant = (id: string) => rentalService.getTenant(id);
export const createTenant = (input: CreateTenantInput) => rentalService.createTenant(input);
export const updateTenant = (id: string, input: UpdateTenantInput) =>
  rentalService.updateTenant(id, input);
export const deleteTenant = (id: string) => rentalService.deleteTenant(id);

// === CONTRACTS ===

export const listContracts = (filter?: ContractFilter) =>
  rentalService.listContracts({ ...filter, parkSlug: PARK });

export const getContract = (id: string) => rentalService.getContract(id);

export const createContract = (input: CreateContractInput) =>
  rentalService.createContract({ ...input, parkSlug: PARK });

export const updateContract = (id: string, input: UpdateContractInput) =>
  rentalService.updateContract(id, input);

export const terminateContract = (id: string, reason?: string) =>
  rentalService.terminateContract(id, reason);

export const getExpiringContracts = (daysAhead = 30) =>
  rentalService.getExpiringContracts(daysAhead, PARK);

// === INQUIRIES ===

export const listInquiries = (filter?: InquiryFilter) =>
  rentalService.listInquiries({ ...filter, parkSlug: PARK });

export const createInquiry = (input: CreateInquiryInput) =>
  rentalService.createInquiry({ ...input, parkSlug: PARK });

export const updateInquiry = (id: string, input: UpdateInquiryInput) =>
  rentalService.updateInquiry(id, input);

// === DEALS ===

export const listDeals = (filter?: DealFilter) =>
  rentalService.listDeals({ ...filter, parkSlug: PARK });

export const getDeal = (id: string) => rentalService.getDeal(id);

export const createDeal = (input: CreateDealInput) =>
  rentalService.createDeal({ ...input, parkSlug: PARK });

export const updateDeal = (id: string, input: UpdateDealInput) =>
  rentalService.updateDeal(id, input);

export const deleteDeal = (id: string) => rentalService.deleteDeal(id);

export const reorderDeals = (updates: ReorderDealInput[]) =>
  rentalService.reorderDeals(updates);

// === REPORTS ===

export const getMonthlyReport = (year: number, month: number) =>
  rentalService.getMonthlyReport(year, month, PARK);

export const getRevenueReport = (building?: number) =>
  rentalService.getRevenueReport(building, PARK);

export const getOccupancyReport = () => rentalService.getOccupancyReport(PARK);

// === IMPORT ===

export const importFromJson = (data: ImportData) => rentalService.importFromJson(data);
