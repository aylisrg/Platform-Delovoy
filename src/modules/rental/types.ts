import type { Office, Tenant, RentalContract, OfficeStatus, ContractStatus, InquiryStatus } from "@prisma/client";

// === Office Types ===

export type RentalOffice = Pick<
  Office,
  "id" | "number" | "floor" | "area" | "pricePerMonth" | "status" | "metadata"
>;

export type CreateOfficeInput = {
  number: string;
  floor: number;
  area: number;
  pricePerMonth: number;
  metadata?: Record<string, unknown>;
};

export type UpdateOfficeInput = Partial<CreateOfficeInput> & {
  status?: OfficeStatus;
};

export type OfficeFilter = {
  status?: OfficeStatus;
  floor?: number;
};

// === Tenant Types ===

export type RentalTenant = Pick<
  Tenant,
  "id" | "companyName" | "contactName" | "email" | "phone" | "inn" | "createdAt"
>;

export type CreateTenantInput = {
  companyName: string;
  contactName: string;
  email?: string;
  phone?: string;
  inn?: string;
};

export type UpdateTenantInput = Partial<CreateTenantInput>;

// === Contract Types ===

export type RentalContractWithRelations = Pick<
  RentalContract,
  "id" | "tenantId" | "officeId" | "startDate" | "endDate" | "monthlyRate" | "deposit" | "status" | "documentUrl" | "notes" | "createdAt"
> & {
  tenant?: RentalTenant;
  office?: RentalOffice;
};

export type CreateContractInput = {
  tenantId: string;
  officeId: string;
  startDate: string; // ISO date YYYY-MM-DD
  endDate: string;   // ISO date YYYY-MM-DD
  monthlyRate: number;
  deposit?: number;
  documentUrl?: string;
  notes?: string;
};

export type UpdateContractInput = Partial<{
  endDate: string;
  monthlyRate: number;
  deposit: number;
  status: ContractStatus;
  documentUrl: string;
  notes: string;
}>;

export type ContractFilter = {
  status?: ContractStatus;
  tenantId?: string;
  officeId?: string;
};

// === Reports ===

export type MonthlyReport = {
  year: number;
  month: number;
  totalRevenue: number;          // Sum of all active contracts monthlyRate
  activeContracts: number;
  occupiedOffices: number;
  totalOffices: number;
  occupancyRate: number;         // %
  newContracts: number;          // Started this month
  terminatedContracts: number;   // Terminated/expired this month
  expiringContracts: number;     // Expiring in next 30 days
};
