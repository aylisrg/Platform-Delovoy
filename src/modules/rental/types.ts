import type {
  Office,
  Tenant,
  RentalContract,
  OfficeStatus,
  ContractStatus,
  InquiryStatus,
  TenantType,
  OfficeType,
} from "@prisma/client";

// === Tenant Types ===

export type RentalTenant = Pick<
  Tenant,
  | "id"
  | "companyName"
  | "tenantType"
  | "contactName"
  | "phone"
  | "phonesExtra"
  | "email"
  | "emailsExtra"
  | "inn"
  | "legalAddress"
  | "needsLegalAddress"
  | "notes"
  | "isDeleted"
  | "createdAt"
>;

export type CreateTenantInput = {
  companyName: string;
  tenantType?: TenantType;
  contactName?: string;
  phone?: string;
  phonesExtra?: string[];
  email?: string;
  emailsExtra?: string[];
  inn?: string;
  legalAddress?: string;
  needsLegalAddress?: boolean;
  notes?: string;
};

export type UpdateTenantInput = Partial<CreateTenantInput>;

export type TenantFilter = {
  search?: string;
  type?: TenantType;
  page?: number;
  limit?: number;
};

// === Office Types ===

export type RentalOffice = Pick<
  Office,
  | "id"
  | "number"
  | "floor"
  | "building"
  | "officeType"
  | "area"
  | "pricePerMonth"
  | "hasWetPoint"
  | "hasToilet"
  | "hasRoofAccess"
  | "status"
  | "metadata"
  | "comment"
>;

export type CreateOfficeInput = {
  number: string;
  floor: number;
  building: number;
  officeType?: OfficeType;
  area: number;
  pricePerMonth: number;
  hasWetPoint?: boolean;
  hasToilet?: boolean;
  hasRoofAccess?: boolean;
  metadata?: Record<string, unknown>;
  comment?: string;
};

export type UpdateOfficeInput = Partial<CreateOfficeInput> & {
  status?: OfficeStatus;
};

export type OfficeFilter = {
  status?: OfficeStatus;
  floor?: number;
  building?: number;
  type?: OfficeType;
};

// === Contract Types ===

export type RentalContractWithRelations = Pick<
  RentalContract,
  | "id"
  | "tenantId"
  | "officeId"
  | "startDate"
  | "endDate"
  | "pricePerSqm"
  | "monthlyRate"
  | "currency"
  | "newPricePerSqm"
  | "priceIncreaseDate"
  | "deposit"
  | "contractNumber"
  | "status"
  | "documentUrl"
  | "notes"
  | "createdAt"
> & {
  tenant?: RentalTenant;
  office?: RentalOffice;
};

export type CreateContractInput = {
  tenantId: string;
  officeId: string;
  startDate: string;
  endDate: string;
  pricePerSqm?: number;
  monthlyRate: number;
  currency?: string;
  deposit?: number;
  contractNumber?: string;
  documentUrl?: string;
  notes?: string;
};

export type UpdateContractInput = Partial<{
  startDate: string;
  endDate: string;
  pricePerSqm: number;
  monthlyRate: number;
  currency: string;
  newPricePerSqm: number;
  priceIncreaseDate: string;
  deposit: number;
  contractNumber: string;
  status: ContractStatus;
  documentUrl: string;
  notes: string;
}>;

export type ContractFilter = {
  status?: ContractStatus | ContractStatus[];
  tenantId?: string;
  officeId?: string;
  page?: number;
  limit?: number;
};

export type RenewContractInput = {
  newEndDate: string;
  newPricePerSqm?: number;
};

// === Inquiry Types ===

export type CreateInquiryInput = {
  name: string;
  phone: string;
  email?: string;
  companyName?: string;
  message?: string;
  officeId?: string;
  officeIds?: string[];
};

export type UpdateInquiryInput = Partial<{
  status: InquiryStatus;
  isRead: boolean;
  adminNotes: string;
  convertedToId: string;
}>;

export type InquiryFilter = {
  status?: InquiryStatus;
  isRead?: boolean;
};

// === Deal Types (Sales Pipeline) ===

export type CreateDealInput = {
  contactName: string;
  phone: string;
  email?: string;
  companyName?: string;
  stage?: DealStage;
  priority?: DealPriority;
  source?: DealSource;
  desiredArea?: string;
  budget?: string;
  moveInDate?: string;
  requirements?: string;
  officeId?: string;
  inquiryId?: string;
  dealValue?: number;
  nextActionDate?: string;
  nextAction?: string;
  adminNotes?: string;
};

export type UpdateDealInput = Partial<CreateDealInput> & {
  lostReason?: string;
  tenantId?: string;
  contractId?: string;
  sortOrder?: number;
};

export type DealFilter = {
  stage?: DealStage | DealStage[];
  priority?: DealPriority;
  source?: DealSource;
};

export type ReorderDealInput = {
  dealId: string;
  newStage: DealStage;
  sortOrder: number;
};

export type DealStage =
  | "NEW_LEAD"
  | "QUALIFICATION"
  | "SHOWING"
  | "PROPOSAL"
  | "NEGOTIATION"
  | "CONTRACT_DRAFT"
  | "WON"
  | "LOST";

export type DealPriority = "HOT" | "WARM" | "COLD";

export type DealSource =
  | "WEBSITE"
  | "PHONE"
  | "WALK_IN"
  | "REFERRAL"
  | "AVITO"
  | "CIAN"
  | "OTHER";

// === Reports ===

export type MonthlyReport = {
  year: number;
  month: number;
  totalRevenue: number;
  activeContracts: number;
  occupiedOffices: number;
  totalOffices: number;
  occupancyRate: number;
  newContracts: number;
  terminatedContracts: number;
  expiringContracts: number;
};

export type OccupancyReport = {
  building: number;
  total: number;
  occupied: number;
  available: number;
  maintenance: number;
  reserved: number;
  occupancyRate: number;
};

export type ImportResult = {
  tenants: number;
  offices: number;
  contracts: number;
  errors: string[];
};
