import type { Booking, Resource, BookingStatus } from "@prisma/client";
import type { BookingItemInput } from "@/modules/inventory/types";

// === Resource Types ===

export type GazeboResource = Pick<
  Resource,
  "id" | "name" | "description" | "capacity" | "pricePerHour" | "isActive" | "metadata"
>;

export type CreateResourceInput = {
  name: string;
  description?: string;
  capacity?: number;
  pricePerHour?: number;
  metadata?: Record<string, unknown>;
};

export type UpdateResourceInput = Partial<CreateResourceInput> & {
  isActive?: boolean;
};

// === Booking Types ===

export type GazeboBooking = Pick<
  Booking,
  "id" | "resourceId" | "userId" | "date" | "startTime" | "endTime" | "status" | "metadata" | "createdAt"
> & {
  resource?: GazeboResource;
};

export type CreateBookingInput = {
  resourceId: string;
  date: string; // ISO date string YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  guestCount?: number;
  comment?: string;
  items?: BookingItemInput[];
};

export type BookingFilter = {
  status?: BookingStatus;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
};

export type AdminCreateBookingInput = {
  resourceId: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount?: number;
  comment?: string;
  clientName: string;
  clientPhone: string;
  items?: BookingItemInput[];
};

// === Availability ===

export type TimeSlot = {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isAvailable: boolean;
};

export type DayAvailability = {
  date: string;
  resource: GazeboResource;
  slots: TimeSlot[];
};
