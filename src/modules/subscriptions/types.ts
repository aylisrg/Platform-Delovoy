import type { SubscriptionStatus, SubscriptionTransactionType } from "@prisma/client";

export type SubscriptionSummary = {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  totalHours: string;
  remainingHours: string;
  validFrom: string;
  validTo: string;
  status: SubscriptionStatus;
  pricePaid: string;
  createdAt: string;
};

export type SubscriptionTransactionView = {
  id: string;
  type: SubscriptionTransactionType;
  hoursDelta: string;
  balanceAfter: string;
  bookingId: string | null;
  reason: string | null;
  performedByName: string;
  createdAt: string;
};

export type SubscriptionDetail = SubscriptionSummary & {
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdById: string;
  transactions: SubscriptionTransactionView[];
};

export type ListSubscriptionsResult = {
  items: SubscriptionSummary[];
  total: number;
};
