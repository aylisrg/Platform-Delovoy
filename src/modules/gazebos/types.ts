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
  // Guest checkout — filled in when the caller is not authenticated.
  // createBooking() accepts userId=null in that case and stores these as
  // clientName/clientPhone on the Booking row.
  guestName?: string;
  guestPhone?: string;
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

// Timeline data for admin grid
export type TimelineData = {
  date: string;
  resources: GazeboResource[];
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

// Analytics
export type ModuleAnalytics = {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalRevenue: number;
  averageCheck: number;
  occupancyRate: number;
  byDay: { date: string; bookings: number; revenue: number }[];
  byResource: { resourceId: string; resourceName: string; bookings: number; revenue: number }[];
  topHours: { hour: number; bookings: number }[];
};

// Module config
export type GazeboModuleConfig = {
  openHour: number;
  closeHour: number;
  minBookingHours: number;
  maxBookingHours: number;
};
