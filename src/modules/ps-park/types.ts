import type { Booking, Resource, BookingStatus } from "@prisma/client";
import type { BookingItemInput } from "@/modules/inventory/types";

export type PSTableResource = Pick<
  Resource,
  "id" | "name" | "description" | "capacity" | "pricePerHour" | "isActive" | "metadata"
>;

export type CreateTableInput = {
  name: string;
  description?: string;
  capacity?: number;
  pricePerHour?: number;
  metadata?: Record<string, unknown>;
};

export type UpdateTableInput = Partial<CreateTableInput> & {
  isActive?: boolean;
};

export type PSBooking = Pick<
  Booking,
  "id" | "resourceId" | "userId" | "date" | "startTime" | "endTime" | "status" | "metadata" | "createdAt"
> & {
  resource?: PSTableResource;
};

export type CreatePSBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  playerCount?: number;
  comment?: string;
  items?: BookingItemInput[];
};

export type AdminCreatePSBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  playerCount?: number;
  comment?: string;
  clientName: string;
  clientPhone?: string;
  items?: BookingItemInput[];
};

export type PSBookingFilter = {
  status?: BookingStatus;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
};

export type TimeSlot = {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
};

export type DayAvailability = {
  date: string;
  resource: PSTableResource;
  slots: TimeSlot[];
};

// Timeline data for admin grid
export type TimelineData = {
  date: string;
  resources: PSTableResource[];
  bookings: TimelineBooking[];
  hours: string[]; // ["08:00", "09:00", ..., "22:00"]
};

export type TimelineBooking = {
  id: string;
  resourceId: string;
  startTime: string; // ISO datetime
  endTime: string;
  status: "PENDING" | "CONFIRMED";
  clientName: string | null;
  clientPhone: string | null;
  metadata: Record<string, unknown> | null;
};

// Active session
export type ActiveSession = {
  bookingId: string;
  resourceId: string;
  resourceName: string;
  clientName: string;
  clientPhone: string | null;
  startTime: string; // ISO
  endTime: string;   // ISO
  status: "CONFIRMED";
  pricePerHour: number;
  durationMin: number;   // booked duration in minutes
  billedHours: number;   // rounded up to nearest 30 min
  hoursCost: number;
  items: BookingItemSnapshotWithSubtotal[];
  itemsTotal: number;
  totalBill: number;
};

export type BookingItemSnapshotWithSubtotal = {
  skuId: string;
  skuName: string;
  quantity: number;
  price: number;
  subtotal: number;
};

// Financial transaction record
export type FinancialTransactionRecord = {
  id: string;
  bookingId: string | null;
  totalAmount: number;
  cashAmount: number;
  cardAmount: number;
  performedByName: string;
  description: string;
  createdAt: string;
};

// Day report (shift summary)
export type DayReport = {
  date: string;
  totalSessions: number;
  cashTotal: number;
  cardTotal: number;
  totalRevenue: number;
  cashCount: number;
  cardCount: number;
  transactions: FinancialTransactionRecord[];
};

// Shift handover
export type ShiftHandoverData = {
  id: string;
  date: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedById: string;
  openedByName: string;
  closedAt: string | null;
  closedById: string | null;
  closedByName: string | null;
  notes: string | null;
};

// Bill for session completion
export type BookingBill = {
  bookingId: string;
  resourceName: string;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMin: number;     // actual duration in minutes
  billedHours: number;     // rounded up to nearest 30 min
  pricePerHour: number;
  hoursCost: number;
  items: BookingItemSnapshotWithSubtotal[];
  itemsTotal: number;
  totalBill: number;
};
