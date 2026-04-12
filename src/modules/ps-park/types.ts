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
  hoursBooked: number;
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

// Bill for session completion
export type BookingBill = {
  bookingId: string;
  resourceName: string;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
  hoursBooked: number;
  pricePerHour: number;
  hoursCost: number;
  items: BookingItemSnapshotWithSubtotal[];
  itemsTotal: number;
  totalBill: number;
};
