export type ModuleUsage = {
  moduleSlug: string;
  moduleName: string;
  firstUsedAt: string;
  count: number;
  totalSpent: number;
};

export type ClientSummary = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  vkId: string | null;
  createdAt: string;
  modulesUsed: ModuleUsage[];
  totalSpent: number;
  bookingCount: number;
  orderCount: number;
  lastActivityAt: string | null;
  authProviders: string[];
};

export type ClientBooking = {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  amount: number;
  createdAt: string;
};

export type ClientOrder = {
  id: string;
  moduleSlug: string;
  status: string;
  totalAmount: number;
  itemCount: number;
  deliveryTo: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  type: "booking" | "order";
  moduleSlug: string;
  action: string;
  description: string;
  amount: number | null;
  createdAt: string;
};

export type MonthlySpending = {
  month: string;
  bookingsSpent: number;
  ordersSpent: number;
  total: number;
};

export type ClientDetail = ClientSummary & {
  bookings: ClientBooking[];
  orders: ClientOrder[];
  activityTimeline: ActivityEvent[];
  spendingByMonth: MonthlySpending[];
  // Editable card fields (F4 ADR — needed so the edit form can prefill
  // birthday and notes; ClientSummary keeps a leaner shape for lists).
  birthday: string | null;
  notes: string | null;
};

export type ClientFilter = {
  search?: string;
  moduleSlug?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "totalSpent" | "lastActivity" | "createdAt" | "name";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type ClientStats = {
  totalClients: number;
  newThisMonth: number;
  newThisWeek: number;
  activeThisMonth: number;
  topSpenders: Array<{ id: string; name: string | null; totalSpent: number }>;
  moduleBreakdown: Array<{
    moduleSlug: string;
    moduleName: string;
    clientCount: number;
  }>;
};

export type MergePreview = {
  primary: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    telegramId: string | null;
    bookingCount: number;
    orderCount: number;
  };
  secondary: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    telegramId: string | null;
    bookingCount: number;
    orderCount: number;
  };
  conflicts: string[];
};

/**
 * Per-table counters of a merge (ADR 2026-10-25 §Q6). Most are rows re-pointed
 * from the secondary account to the primary; `sessions` counts the secondary's
 * DB sessions that were revoked (deleted, AC-E2.9), `moduleAssignments` /
 * `adminPermissions` stay 0 — the secondary's rights are deleted, never moved
 * (AC-E2.4а; see `droppedSecondaryRights` in the audit row).
 */
export type MergeMovedCounters = {
  bookings: number;
  orders: number;
  accounts: number;
  auditLogs: number;
  feedbackItems: number;
  notificationLogs: number;
  sessions: number;
  moduleAssignments: number;
  adminPermissions: number;
  rentalChangeLogs: number;
  notificationPreferences: number;
  telegramLinkTokens: number;
  backupLogs: number;
  callLogs: number;
  // Phase 5.4 — tasks + channel-agnostic notifications
  reportedTasks: number;
  taskAssignments: number;
  taskComments: number;
  taskEvents: number;
  taskSubscriptions: number;
  savedTaskViews: number;
  notificationChannels: number;
  notificationEventPrefs: number;
  notificationGlobalPref: number;
  outgoingNotifications: number;
  // ADR 2026-10-25 §Q6 — moved in addition to the legacy set
  subscriptions: number;
  chatsCreated: number;
  chatMessages: number;
  chatParticipants: number;
  chatReceipts: number;
  inAppNotifications: number;
  webPushSubscriptions: number;
  deliverySkips: number;
  notificationLinks: number;
  recipientLists: number;
  /** OutgoingNotification rows of duplicate channels re-pointed to the primary's channel. */
  outgoingRepointed: number;
  mergeCandidatesResolved: number;
  mergeCandidatesDismissed: number;
};

/**
 * Soft-merge result. Secondary user is NOT deleted — it's tombstoned
 * via `mergedIntoUserId` + `mergedAt`, and unique fields are nulled so
 * a fresh login can claim them. See ADR 2026-04-27 §6.
 */
export type MergeResult = {
  primaryId: string;
  /** Per-table count of FK rows reassigned from secondary to primary. */
  merged: MergeMovedCounters;
  /** Tombstoned (not deleted). Populated for backwards-compat with old callers. */
  deletedUserId: string;
  tombstonedUserId: string;
};

// ─── Account merge engine (ADR 2026-10-25-team-access-notifications §5.4) ───

export type MergeMode = "admin" | "clients_only" | "self_link";

export type MergeRole = "SUPERADMIN" | "ADMIN" | "MANAGER" | "USER";

/** Bot status DTO (same shape as `telegram-link/bot-contact.ts#BotStatusDto`). */
export type MergeBotStatusDto =
  | { state: "NOT_LINKED" }
  | { state: "NOT_STARTED"; trackingSince: string | null }
  | { state: "STARTED"; startedAt: string | null }
  | { state: "BLOCKED"; blockedAt: string };

/** Short account card for search, the request queue and «Кого оставить». No telegramId. */
export type AccountBrief = {
  id: string;
  name: string | null;
  role: MergeRole;
  email: string | null;
  phone: string | null;
  hasTelegram: boolean;
  createdAt: string;
};

export type AccountSide = {
  id: string;
  name: string | null;
  role: MergeRole;
  email: string | null;
  phone: string | null;
  hasTelegram: boolean;
  hasVk: boolean;
  createdAt: string;
  source: string | null;
  isSeededSuperadmin: boolean;
  botStatus: MergeBotStatusDto;
};

export type MergeConflictField = "email" | "phone" | "telegram" | "vk" | "name";

export type MergeConflict = {
  field: MergeConflictField;
  /** Telegram / VK are shown as «привязан» — identifiers never leave the server. */
  primaryValue: string | null;
  secondaryValue: string | null;
  requiresConfirmation: boolean;
};

export type AccountMergePreview = {
  primary: AccountSide;
  secondary: AccountSide;
  suggestedPrimaryId: string;
  result: {
    role: MergeRole;
    name: string | null;
    email: string | null;
    phone: string | null;
    telegramLinked: boolean;
    vkLinked: boolean;
  };
  conflicts: MergeConflict[];
  /** What the merged account can access — the primary's (labels). */
  access: { sections: string[]; modules: string[]; recipientLists: string[] };
  /** Personal staff subscriptions (event labels). */
  subscriptions: { kept: string[]; moved: string[]; droppedConflicts: string[] };
  /** Delivery channels (labels): primary's kept, secondary's moved, duplicates folded into the primary's. */
  channels: { kept: string[]; moved: string[]; duplicates: string[] };
  transfer: {
    bookings: number;
    orders: number;
    subscriptions: number;
    tasks: number;
    chatMessages: number;
    auditLogs: number;
    notifications: number;
  };
  notTransferred: Array<{ key: "secondaryRole" | "sections" | "modules" | "recipientLists"; label: string; items: string[] }>;
  blockers: Array<{ code: string; message: string }>;
};

export type AccountMergeResult = {
  primaryId: string;
  tombstonedUserId: string;
  resultingRole: MergeRole;
  moved: MergeMovedCounters;
};

/** Search hit of `GET /api/users/merge/search`. */
export type MergeSearchHit = {
  id: string;
  name: string | null;
  role: MergeRole;
  email: string | null;
  phone: string | null;
  hasTelegram: boolean;
};

/** Queue item of `GET /api/users/merge-requests` (pending MergeCandidate). */
export type MergeRequestItem = {
  id: string;
  detectedAt: string;
  matchedFields: string[];
  reasonLabel: string;
  users: [AccountBrief, AccountBrief];
};
