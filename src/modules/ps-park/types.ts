import type { Booking, Resource, BookingStatus } from "@prisma/client";

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
