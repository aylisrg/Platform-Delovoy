import type { NotificationChannelKind, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { maskChatId } from "@/lib/audit";
import { ADMIN_SECTIONS, computeAdminSections } from "@/lib/permissions";
import { isSeededSuperadmin } from "@/lib/seeded-superadmin";
import { bumpSessionVersion, publishAuthState } from "@/lib/session-revocation";
import { NOTIFICATION_CATALOG } from "@/modules/notifications/catalog";
import {
  computeBotStatus,
  getBotContacts,
  getBotTrackingSince,
  toBotStatusDto,
} from "@/modules/telegram-link/bot-contact";
import { ROLE_RANK } from "@/modules/users/types";
import { MERGE_ERROR_MESSAGES, mergeError, type MergeBlockerCode } from "./merge-errors";
import type {
  AccountMergePreview,
  AccountMergeResult,
  AccountSide,
  MergeConflict,
  MergeMode,
  MergeMovedCounters,
  MergePreview,
  MergeResult,
  MergeRole,
} from "./types";

/**
 * Account merge engine (ADR 2026-10-25-team-access-notifications §Q6, §5.4;
 * PRD US-E2). One engine for every pair — client ↔ client (legacy
 * `mergeClients`, mode `clients_only`), staff ↔ client/staff (SUPERADMIN UI,
 * mode `admin`) and the Telegram self-link of a disposable bot account
 * (mode `self_link`, OTP / deep-link).
 *
 * Rules (AC-E2.4):
 *  (а) role and rights are the primary's. The secondary's AdminPermission and
 *      ModuleAssignment rows are deleted (never moved); the secondary becomes
 *      USER, its sessionVersion is bumped and it is tombstoned.
 *  (б) the system never ends up without an active SUPERADMIN.
 *  (в) NotificationEventPreference: the primary wins per eventType, the rest moves.
 *  (г) contacts: the primary keeps its values, empty fields are filled from the
 *      secondary — after the secondary's unique fields are freed (the old code
 *      filled first and hit P2002). A Telegram conflict needs explicit consent.
 *  (д) the seeded SUPERADMIN can't be the secondary (the seeder would create a
 *      new SUPERADMIN on the next deploy).
 *
 * Everything runs in one interactive transaction that first locks both rows
 * (and every active SUPERADMIN, for guard (б)) with one ordered
 * `SELECT … FOR UPDATE`: a concurrent merge of the same pair waits and then
 * sees the tombstone → ALREADY_MERGED, without partial changes (AC-E2.7).
 */

export const MERGE_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;
export const MERGE_AUDIT_ACTIONS: Record<MergeMode, string> = {
  admin: "auth.merge.manual",
  clients_only: "auth.merge.manual",
  self_link: "auth.merge.self_link",
};

/** Seeded system user (`scripts/seeds/core.ts`) never counts as a SUPERADMIN. */
const SYSTEM_USER_ID = "system";

type Tx = Prisma.TransactionClient;

const ROLE_LABELS: Record<MergeRole, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

const CHANNEL_LABELS: Partial<Record<NotificationChannelKind, string>> = {
  TELEGRAM: "Telegram",
  EMAIL: "Email",
  PUSH: "Push в браузере",
  VK: "VK",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  MAX: "MAX",
  IMESSAGE: "iMessage",
  AVITO: "Авито",
};

// Lazy: `@/lib/permissions` is partially mocked by legacy clients tests.
let sectionLabels: Map<string, string> | null = null;
const EVENT_LABELS = new Map<string, string>(
  NOTIFICATION_CATALOG.flatMap((c) => c.events.map((e) => [e.eventType, e.label] as const)),
);

function sectionLabel(slug: string): string {
  sectionLabels ??= new Map<string, string>(ADMIN_SECTIONS.map((s) => [s.slug, s.label]));
  return sectionLabels.get(slug) ?? slug;
}
const channelLabel = (kind: NotificationChannelKind) => CHANNEL_LABELS[kind] ?? kind;
const LINKED = "привязан";

// ─── suggestPrimary ─────────────────────────────────────────────────────────

type SuggestCandidate = { id: string; role: string; email: string | null; createdAt: Date | string };

function rank(role: string): number {
  return ROLE_RANK[role as Role] ?? 0;
}

/**
 * Default «Кого оставить» (AC-E2.2): higher role; on a tie — the one with an
 * email; otherwise the older account (then the smaller id, for determinism).
 */
export function suggestPrimary(a: SuggestCandidate, b: SuggestCandidate): string {
  if (rank(a.role) !== rank(b.role)) return rank(a.role) > rank(b.role) ? a.id : b.id;
  if (Boolean(a.email) !== Boolean(b.email)) return a.email ? a.id : b.id;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta < tb ? a.id : b.id;
  return a.id < b.id ? a.id : b.id;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  image: true,
  role: true,
  telegramId: true,
  vkId: true,
  emailNormalized: true,
  phoneNormalized: true,
  emailVerified: true,
  passwordHash: true,
  mergedIntoUserId: true,
  createdAt: true,
  source: true,
} satisfies Prisma.UserSelect;

type MergeUser = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function computeConflicts(primary: MergeUser, secondary: MergeUser): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  if (primary.email && secondary.email && !sameText(primary.email, secondary.email)) {
    conflicts.push({ field: "email", primaryValue: primary.email, secondaryValue: secondary.email, requiresConfirmation: false });
  }
  if (primary.phone && secondary.phone && primary.phone !== secondary.phone) {
    conflicts.push({ field: "phone", primaryValue: primary.phone, secondaryValue: secondary.phone, requiresConfirmation: false });
  }
  if (primary.telegramId && secondary.telegramId && primary.telegramId !== secondary.telegramId) {
    conflicts.push({ field: "telegram", primaryValue: LINKED, secondaryValue: LINKED, requiresConfirmation: true });
  }
  if (primary.vkId && secondary.vkId && primary.vkId !== secondary.vkId) {
    conflicts.push({ field: "vk", primaryValue: LINKED, secondaryValue: LINKED, requiresConfirmation: false });
  }
  if (primary.name && secondary.name && primary.name.trim() !== secondary.name.trim()) {
    conflicts.push({ field: "name", primaryValue: primary.name, secondaryValue: secondary.name, requiresConfirmation: false });
  }
  return conflicts;
}

/** Conflicts as written to AuditLog: secondary values kept (AC-E2.8), identifiers masked. */
function auditConflicts(primary: MergeUser, secondary: MergeUser) {
  return computeConflicts(primary, secondary).map((c) => {
    if (c.field === "telegram") {
      return { field: c.field, primaryValue: maskChatId(primary.telegramId), secondaryValue: maskChatId(secondary.telegramId) };
    }
    if (c.field === "vk") {
      return { field: c.field, primaryValue: maskChatId(primary.vkId), secondaryValue: maskChatId(secondary.vkId) };
    }
    return { field: c.field, primaryValue: c.primaryValue, secondaryValue: c.secondaryValue };
  });
}

function hasTelegramConflict(primary: MergeUser, secondary: MergeUser): boolean {
  return Boolean(primary.telegramId && secondary.telegramId && primary.telegramId !== secondary.telegramId);
}

function earliest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (a && b) return a.getTime() <= b.getTime() ? a : b;
  return a ?? b ?? null;
}

// Legacy `clients_only` errors keep the texts the old admin clients UI and
// `autoMergeOnLogin` callers expect (plain Error → 400 MERGE_ERROR).
const LEGACY = {
  same: "Нельзя объединить аккаунт сам с собой",
  primaryMissing: "Основной клиент не найден",
  secondaryMissing: "Второй клиент не найден",
  primaryNotClient: "Основной аккаунт не является клиентом",
  secondaryNotClient: "Второй аккаунт не является клиентом",
  primaryMerged: "Основной клиент уже объединён в другой аккаунт",
  secondaryMerged: "Второй клиент уже объединён в другой аккаунт",
} as const;

// ─── Preview ────────────────────────────────────────────────────────────────

async function countOtherActiveSuperadmins(excludeIds: string[]): Promise<number> {
  return prisma.user.count({
    where: { role: "SUPERADMIN", mergedIntoUserId: null, id: { notIn: [SYSTEM_USER_ID, ...excludeIds] } },
  });
}

function blocker(code: MergeBlockerCode) {
  return { code, message: MERGE_ERROR_MESSAGES[code] };
}

/**
 * «Превью» (AC-E2.3): what stays, what moves, what is not transferred and
 * which guards block the merge. Reads only — nothing is changed.
 */
/**
 * Who may sit in a module recipient list — the same rule as
 * `setRecipientUserIds`: SUPERADMIN and ADMIN always, MANAGER only with an
 * assignment to that module. A row the primary isn't admitted to is dropped on
 * merge: it would never deliver, yet it would still count as a list member and
 * silence the module's group chat.
 */
function admittedToRecipientList(role: Role, assignedSlugs: ReadonlySet<string>, moduleSlug: string): boolean {
  if (role === "SUPERADMIN" || role === "ADMIN") return true;
  return role === "MANAGER" && assignedSlugs.has(moduleSlug);
}

export async function previewAccountMerge(input: {
  primaryId: string;
  secondaryId: string;
  actorId: string;
  mode: MergeMode;
}): Promise<AccountMergePreview> {
  const { primaryId, secondaryId, actorId } = input;
  if (primaryId === secondaryId) throw mergeError("SAME_ACCOUNT");
  // The technical `system` user is never a merge participant (it owns system rows).
  if (primaryId === SYSTEM_USER_ID || secondaryId === SYSTEM_USER_ID) throw mergeError("USER_NOT_FOUND");

  const [primary, secondary] = await Promise.all([
    prisma.user.findUnique({ where: { id: primaryId }, select: USER_FIELDS }),
    prisma.user.findUnique({ where: { id: secondaryId }, select: USER_FIELDS }),
  ]);
  if (!primary || !secondary) throw mergeError("USER_NOT_FOUND");

  const pair = [primaryId, secondaryId];
  const [grants, assignments, lists, prefs, channels, activeSubs] = await Promise.all([
    prisma.adminPermission.findMany({ where: { userId: { in: pair } }, select: { userId: true, section: true } }),
    prisma.moduleAssignment.findMany({
      where: { userId: { in: pair } },
      select: { userId: true, module: { select: { slug: true, name: true } } },
    }),
    prisma.moduleNotificationRecipient.findMany({
      where: { userId: { in: pair } },
      select: { userId: true, moduleSlug: true, module: { select: { name: true } } },
    }),
    prisma.notificationEventPreference.findMany({
      where: { userId: { in: pair } },
      select: { userId: true, eventType: true, enabled: true },
    }),
    prisma.userNotificationChannel.findMany({
      where: { userId: { in: pair } },
      select: { userId: true, kind: true, address: true },
    }),
    prisma.subscription.groupBy({
      by: ["userId"],
      where: { userId: { in: pair }, status: "ACTIVE" },
      _count: { _all: true },
    }),
  ]);

  const [bookings, orders, subscriptions, reportedTasks, assignedTasks, chatMessages, auditLogs, outgoing, inApp] =
    await Promise.all([
      prisma.booking.count({ where: { userId: secondaryId } }),
      prisma.order.count({ where: { userId: secondaryId } }),
      prisma.subscription.count({ where: { userId: secondaryId } }),
      prisma.task.count({ where: { reporterUserId: secondaryId } }),
      prisma.taskAssignee.count({ where: { userId: secondaryId } }),
      prisma.chatMessage.count({ where: { senderUserId: secondaryId } }),
      prisma.auditLog.count({ where: { userId: secondaryId } }),
      prisma.outgoingNotification.count({ where: { userId: secondaryId } }),
      prisma.inAppNotification.count({ where: { userId: secondaryId } }),
    ]);

  const telegramIds = [primary.telegramId, secondary.telegramId].filter((t): t is string => Boolean(t));
  const [contacts, trackingSince] = await Promise.all([getBotContacts(telegramIds), getBotTrackingSince()]);

  const side = (u: MergeUser): AccountSide => ({
    id: u.id,
    name: u.name,
    role: u.role,
    email: u.email,
    phone: u.phone,
    hasTelegram: Boolean(u.telegramId),
    hasVk: Boolean(u.vkId),
    createdAt: u.createdAt.toISOString(),
    source: u.source,
    isSeededSuperadmin: isSeededSuperadmin(u),
    botStatus: toBotStatusDto(
      computeBotStatus(u.telegramId, u.telegramId ? contacts.get(u.telegramId) : null, trackingSince),
    ),
  });

  const grantsOf = (id: string) => grants.filter((g) => g.userId === id).map((g) => g.section);
  const modulesOf = (id: string) => assignments.filter((a) => a.userId === id).map((a) => a.module);
  const primarySections = computeAdminSections(primary.role, grantsOf(primaryId));
  const secondarySections = computeAdminSections(secondary.role, grantsOf(secondaryId));
  const primaryModules = modulesOf(primaryId);
  const primaryModuleSlugs = new Set(primaryModules.map((m) => m.slug));

  const listNames = new Map<string, string>();
  const droppedListNames = new Map<string, string>();
  for (const l of lists) {
    const keep = l.userId === primaryId || admittedToRecipientList(primary.role, primaryModuleSlugs, l.moduleSlug);
    (keep ? listNames : droppedListNames).set(l.moduleSlug, l.module.name);
  }
  for (const slug of listNames.keys()) droppedListNames.delete(slug);

  const catalogPrefs = prefs.filter((p) => EVENT_LABELS.has(p.eventType));
  const prefLabel = (p: { eventType: string; enabled: boolean }) =>
    `${EVENT_LABELS.get(p.eventType)}${p.enabled ? "" : " (выкл.)"}`;
  const primaryPrefs = catalogPrefs.filter((p) => p.userId === primaryId);
  const primaryPrefTypes = new Set(prefs.filter((p) => p.userId === primaryId).map((p) => p.eventType));
  const secondaryPrefs = catalogPrefs.filter((p) => p.userId === secondaryId);

  const primaryChannelKeys = new Set(
    channels.filter((c) => c.userId === primaryId).map((c) => `${c.kind}::${c.address}`),
  );
  const secondaryChannels = channels.filter((c) => c.userId === secondaryId);

  const notTransferred: AccountMergePreview["notTransferred"] = [];
  if (secondary.role !== "USER" && secondary.role !== primary.role) {
    notTransferred.push({ key: "secondaryRole", label: "Роль второго аккаунта", items: [ROLE_LABELS[secondary.role]] });
  }
  const lostSections = secondarySections.filter((s) => !primarySections.includes(s)).map(sectionLabel);
  if (lostSections.length > 0) {
    notTransferred.push({ key: "sections", label: "Разделы админки второго аккаунта", items: lostSections });
  }
  const lostModules = modulesOf(secondaryId).filter((m) => !primaryModuleSlugs.has(m.slug)).map((m) => m.name);
  if (lostModules.length > 0) {
    notTransferred.push({ key: "modules", label: "Назначения на модули второго аккаунта", items: lostModules });
  }
  if (droppedListNames.size > 0) {
    notTransferred.push({
      key: "recipientLists",
      label: "Списки получателей, куда основной аккаунт не допущен",
      items: [...droppedListNames.values()],
    });
  }

  const blockers: AccountMergePreview["blockers"] = [];
  if (primary.mergedIntoUserId || secondary.mergedIntoUserId) blockers.push(blocker("ALREADY_MERGED"));
  if (secondaryId === actorId) blockers.push(blocker("SECONDARY_IS_ACTOR"));
  if (isSeededSuperadmin(secondary)) blockers.push(blocker("SECONDARY_SEEDED_SUPERADMIN"));
  if (
    secondary.role === "SUPERADMIN" &&
    primary.role !== "SUPERADMIN" &&
    (await countOtherActiveSuperadmins([secondaryId])) === 0
  ) {
    blockers.push(blocker("LAST_SUPERADMIN"));
  }
  if (activeSubs.length === 2 && activeSubs.every((s) => s._count._all > 0)) {
    blockers.push(blocker("ACTIVE_SUBSCRIPTION_CONFLICT"));
  }

  return {
    primary: side(primary),
    secondary: side(secondary),
    suggestedPrimaryId: suggestPrimary(primary, secondary),
    result: {
      role: primary.role,
      name: primary.name ?? secondary.name,
      email: primary.email ?? secondary.email,
      phone: primary.phone ?? secondary.phone,
      telegramLinked: Boolean(primary.telegramId ?? secondary.telegramId),
      vkLinked: Boolean(primary.vkId ?? secondary.vkId),
    },
    conflicts: computeConflicts(primary, secondary),
    access: {
      sections: primarySections.map(sectionLabel),
      modules: primaryModules.map((m) => m.name),
      recipientLists: [...listNames.values()],
    },
    subscriptions: {
      kept: primaryPrefs.map(prefLabel),
      moved: secondaryPrefs.filter((p) => !primaryPrefTypes.has(p.eventType)).map(prefLabel),
      droppedConflicts: secondaryPrefs.filter((p) => primaryPrefTypes.has(p.eventType)).map(prefLabel),
    },
    channels: {
      kept: channels.filter((c) => c.userId === primaryId).map((c) => channelLabel(c.kind)),
      moved: [
        ...secondaryChannels
          .filter((c) => !primaryChannelKeys.has(`${c.kind}::${c.address}`))
          .map((c) => channelLabel(c.kind)),
        // The merge creates it for a staff primary (see runMerge, after step 16).
        ...(primary.role !== "USER" &&
        !primary.telegramId &&
        secondary.telegramId &&
        !secondaryChannels.some((c) => c.kind === "TELEGRAM" && c.address === secondary.telegramId)
          ? [channelLabel("TELEGRAM")]
          : []),
      ],
      duplicates: secondaryChannels
        .filter((c) => primaryChannelKeys.has(`${c.kind}::${c.address}`))
        .map((c) => channelLabel(c.kind)),
    },
    transfer: {
      bookings,
      orders,
      subscriptions,
      tasks: reportedTasks + assignedTasks,
      chatMessages,
      auditLogs,
      notifications: outgoing + inApp,
    },
    notTransferred,
    blockers,
  };
}

// ─── Execute ────────────────────────────────────────────────────────────────

type LockRow = { id: string; role: string; mergedIntoUserId: string | null };

/**
 * One ordered statement locks the pair and every active SUPERADMIN (same
 * pattern as the exclusion): deadlock-free against concurrent exclusions /
 * demotions, and the «last superadmin» guard sees committed state.
 */
async function lockPairAndSuperadmins(tx: Tx, primaryId: string, secondaryId: string): Promise<LockRow[]> {
  return tx.$queryRaw<LockRow[]>`
    SELECT "id", "role"::text AS "role", "mergedIntoUserId"
    FROM "User"
    WHERE "id" IN (${primaryId}, ${secondaryId})
       OR ("role" = 'SUPERADMIN' AND "mergedIntoUserId" IS NULL AND "id" <> 'system')
    ORDER BY "id"
    FOR UPDATE
  `;
}

function emptyCounters(): MergeMovedCounters {
  return {
    bookings: 0,
    orders: 0,
    accounts: 0,
    auditLogs: 0,
    feedbackItems: 0,
    notificationLogs: 0,
    sessions: 0,
    moduleAssignments: 0,
    adminPermissions: 0,
    rentalChangeLogs: 0,
    notificationPreferences: 0,
    telegramLinkTokens: 0,
    backupLogs: 0,
    callLogs: 0,
    reportedTasks: 0,
    taskAssignments: 0,
    taskComments: 0,
    taskEvents: 0,
    taskSubscriptions: 0,
    savedTaskViews: 0,
    notificationChannels: 0,
    notificationEventPrefs: 0,
    notificationGlobalPref: 0,
    outgoingNotifications: 0,
    subscriptions: 0,
    chatsCreated: 0,
    chatMessages: 0,
    chatParticipants: 0,
    chatReceipts: 0,
    inAppNotifications: 0,
    webPushSubscriptions: 0,
    deliverySkips: 0,
    notificationLinks: 0,
    recipientLists: 0,
    outgoingRepointed: 0,
    mergeCandidatesResolved: 0,
    mergeCandidatesDismissed: 0,
  };
}

/** Rows of a unique-per-user relation: the primary's copy wins, the rest moves. */
async function moveDeduped<T extends { id: string }>(opts: {
  primaryKeys: Set<string>;
  secondaryRows: T[];
  key: (row: T) => string;
  remove: (ids: string[]) => Promise<unknown>;
  move: () => Promise<{ count: number }>;
}): Promise<number> {
  const dupIds = opts.secondaryRows.filter((r) => opts.primaryKeys.has(opts.key(r))).map((r) => r.id);
  if (dupIds.length > 0) await opts.remove(dupIds);
  if (opts.secondaryRows.length === dupIds.length) return 0;
  return (await opts.move()).count;
}

async function runMerge(
  tx: Tx,
  input: { primaryId: string; secondaryId: string; actorId: string; mode: MergeMode; confirmTelegramConflict?: boolean },
): Promise<AccountMergeResult> {
  const { primaryId, secondaryId, actorId, mode } = input;
  const legacy = mode === "clients_only";

  // ── 0. Lock, then read committed state of both rows.
  const locked = await lockPairAndSuperadmins(tx, primaryId, secondaryId);
  const [primary, secondary] = await Promise.all([
    tx.user.findUnique({ where: { id: primaryId }, select: USER_FIELDS }),
    tx.user.findUnique({ where: { id: secondaryId }, select: USER_FIELDS }),
  ]);

  if (!primary) throw legacy ? new Error(LEGACY.primaryMissing) : mergeError("USER_NOT_FOUND");
  if (!secondary) throw legacy ? new Error(LEGACY.secondaryMissing) : mergeError("USER_NOT_FOUND");
  if (legacy) {
    if (primary.role !== "USER") throw new Error(LEGACY.primaryNotClient);
    if (secondary.role !== "USER") throw new Error(LEGACY.secondaryNotClient);
    if (primary.mergedIntoUserId) throw new Error(LEGACY.primaryMerged);
    if (secondary.mergedIntoUserId) throw new Error(LEGACY.secondaryMerged);
  } else {
    if (primary.mergedIntoUserId || secondary.mergedIntoUserId) throw mergeError("ALREADY_MERGED");
    if (secondaryId === actorId) throw mergeError("SECONDARY_IS_ACTOR");
  }
  if (isSeededSuperadmin(secondary)) throw mergeError("SECONDARY_SEEDED_SUPERADMIN");

  if (secondary.role === "SUPERADMIN" && primary.role !== "SUPERADMIN") {
    const others = locked.filter(
      (r) => r.id !== secondaryId && r.id !== SYSTEM_USER_ID && r.role === "SUPERADMIN" && r.mergedIntoUserId === null,
    );
    if (others.length === 0) throw mergeError("LAST_SUPERADMIN");
  }

  const [primaryActive, secondaryActive] = await Promise.all([
    tx.subscription.count({ where: { userId: primaryId, status: "ACTIVE" } }),
    tx.subscription.count({ where: { userId: secondaryId, status: "ACTIVE" } }),
  ]);
  if (primaryActive > 0 && secondaryActive > 0) throw mergeError("ACTIVE_SUBSCRIPTION_CONFLICT");

  const telegramConflict = hasTelegramConflict(primary, secondary);
  if (telegramConflict && !legacy && !input.confirmTelegramConflict) {
    throw mergeError("TELEGRAM_CONFLICT_UNCONFIRMED");
  }

  const now = new Date();
  const moved = emptyCounters();
  const conflicts = auditConflicts(primary, secondary);

  // ── 1. Plain FK transfers (no unique constraint involving userId).
  const [
    bookings,
    orders,
    auditLogs,
    feedbackItems,
    notificationLogs,
    rentalChangeLogs,
    telegramLinkTokens,
    backupLogs,
    reportedTasks,
    taskComments,
    taskEvents,
    savedTaskViews,
    subscriptions,
    chatsCreated,
    chatMessages,
    inAppNotifications,
    webPushSubscriptions,
    deliverySkips,
    notificationLinks,
    sessions,
  ] = await Promise.all([
    tx.booking.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.order.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.auditLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.feedbackItem.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.notificationLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.rentalChangeLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.telegramLinkToken.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.backupLog.updateMany({ where: { performedById: secondaryId }, data: { performedById: primaryId } }),
    tx.task.updateMany({ where: { reporterUserId: secondaryId }, data: { reporterUserId: primaryId } }),
    tx.taskComment.updateMany({ where: { authorUserId: secondaryId }, data: { authorUserId: primaryId } }),
    tx.taskEvent.updateMany({ where: { actorUserId: secondaryId }, data: { actorUserId: primaryId } }),
    tx.savedTaskView.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.subscription.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.chat.updateMany({ where: { createdByUserId: secondaryId }, data: { createdByUserId: primaryId } }),
    tx.chatMessage.updateMany({ where: { senderUserId: secondaryId }, data: { senderUserId: primaryId } }),
    tx.inAppNotification.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.webPushSubscription.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.notificationDeliverySkip.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    tx.notificationLink.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
    // AC-E2.9: the secondary's open sessions end (JWT sessions are cut by the
    // sessionVersion bump below; DB sessions are dropped, never handed over).
    tx.session.deleteMany({ where: { userId: secondaryId } }),
  ]);
  Object.assign(moved, {
    bookings: bookings.count,
    orders: orders.count,
    auditLogs: auditLogs.count,
    feedbackItems: feedbackItems.count,
    notificationLogs: notificationLogs.count,
    rentalChangeLogs: rentalChangeLogs.count,
    telegramLinkTokens: telegramLinkTokens.count,
    backupLogs: backupLogs.count,
    reportedTasks: reportedTasks.count,
    taskComments: taskComments.count,
    taskEvents: taskEvents.count,
    savedTaskViews: savedTaskViews.count,
    subscriptions: subscriptions.count,
    chatsCreated: chatsCreated.count,
    chatMessages: chatMessages.count,
    inAppNotifications: inAppNotifications.count,
    webPushSubscriptions: webPushSubscriptions.count,
    deliverySkips: deliverySkips.count,
    notificationLinks: notificationLinks.count,
    sessions: sessions.count,
  });

  // ── 2. Account: @@unique([provider, providerAccountId]).
  const [primaryAccounts, secondaryAccounts] = await Promise.all([
    tx.account.findMany({ where: { userId: primaryId }, select: { provider: true, providerAccountId: true } }),
    tx.account.findMany({ where: { userId: secondaryId }, select: { id: true, provider: true, providerAccountId: true } }),
  ]);
  moved.accounts = await moveDeduped({
    primaryKeys: new Set(primaryAccounts.map((a) => `${a.provider}::${a.providerAccountId}`)),
    secondaryRows: secondaryAccounts,
    key: (a) => `${a.provider}::${a.providerAccountId}`,
    remove: (ids) => tx.account.deleteMany({ where: { id: { in: ids } } }),
    move: () => tx.account.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
  });

  // ── 3. Rights of the secondary are deleted, not moved (AC-E2.4а).
  const [droppedGrants, droppedAssignments] = await Promise.all([
    tx.adminPermission.findMany({ where: { userId: secondaryId }, select: { section: true } }),
    tx.moduleAssignment.findMany({ where: { userId: secondaryId }, select: { module: { select: { slug: true } } } }),
  ]);
  await Promise.all([
    tx.adminPermission.deleteMany({ where: { userId: secondaryId } }),
    tx.moduleAssignment.deleteMany({ where: { userId: secondaryId } }),
  ]);

  // ── 4. NotificationPreference: userId is @unique.
  const primaryNotifPref = await tx.notificationPreference.findUnique({
    where: { userId: primaryId },
    select: { id: true },
  });
  if (primaryNotifPref) {
    await tx.notificationPreference.deleteMany({ where: { userId: secondaryId } });
  } else {
    moved.notificationPreferences = (
      await tx.notificationPreference.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } })
    ).count;
  }

  // ── 5. TaskAssignee: @@unique([taskId, userId]).
  const [primaryTaskAssignments, secondaryTaskAssignments] = await Promise.all([
    tx.taskAssignee.findMany({ where: { userId: primaryId }, select: { taskId: true } }),
    tx.taskAssignee.findMany({ where: { userId: secondaryId }, select: { id: true, taskId: true } }),
  ]);
  moved.taskAssignments = await moveDeduped({
    primaryKeys: new Set(primaryTaskAssignments.map((a) => a.taskId)),
    secondaryRows: secondaryTaskAssignments,
    key: (a) => a.taskId,
    remove: (ids) => tx.taskAssignee.deleteMany({ where: { id: { in: ids } } }),
    move: () => tx.taskAssignee.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
  });

  // ── 6. TaskSubscription: @@unique([userId, scope, taskId, boardId, categoryId]).
  type SubKey = { scope: string; taskId: string | null; boardId: string | null; categoryId: string | null };
  const subKey = (s: SubKey) => `${s.scope}::${s.taskId ?? ""}::${s.boardId ?? ""}::${s.categoryId ?? ""}`;
  const [primaryTaskSubs, secondaryTaskSubs] = await Promise.all([
    tx.taskSubscription.findMany({
      where: { userId: primaryId },
      select: { scope: true, taskId: true, boardId: true, categoryId: true },
    }),
    tx.taskSubscription.findMany({
      where: { userId: secondaryId },
      select: { id: true, scope: true, taskId: true, boardId: true, categoryId: true },
    }),
  ]);
  moved.taskSubscriptions = await moveDeduped({
    primaryKeys: new Set(primaryTaskSubs.map(subKey)),
    secondaryRows: secondaryTaskSubs,
    key: subKey,
    remove: (ids) => tx.taskSubscription.deleteMany({ where: { id: { in: ids } } }),
    move: () => tx.taskSubscription.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
  });

  // ── 7. UserNotificationChannel: @@unique([userId, kind, address]). A
  // duplicate channel's delivery history is re-pointed to the primary's
  // channel (not deleted), then the duplicate goes.
  const [primaryChannels, secondaryChannels] = await Promise.all([
    tx.userNotificationChannel.findMany({
      where: { userId: primaryId },
      select: { id: true, kind: true, address: true, webPushSubscription: { select: { id: true } } },
    }),
    tx.userNotificationChannel.findMany({ where: { userId: secondaryId }, select: { id: true, kind: true, address: true } }),
  ]);
  const primaryChannelByKey = new Map(primaryChannels.map((c) => [`${c.kind}::${c.address}`, c]));
  for (const sc of secondaryChannels) {
    const target = primaryChannelByKey.get(`${sc.kind}::${sc.address}`);
    if (!target) continue;
    const repointed = await tx.outgoingNotification.updateMany({
      where: { channelId: sc.id },
      data: { channelId: target.id },
    });
    moved.outgoingRepointed += repointed.count;
    if (!target.webPushSubscription) {
      // Keep the browser subscription attached to the surviving channel
      // (otherwise ON DELETE SET NULL would orphan it).
      await tx.webPushSubscription.updateMany({
        where: { userNotificationChannelId: sc.id },
        data: { userNotificationChannelId: target.id },
      });
    }
    await tx.userNotificationChannel.delete({ where: { id: sc.id } });
  }
  moved.notificationChannels = (
    await tx.userNotificationChannel.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } })
  ).count;

  // ── 8. NotificationEventPreference: the primary wins per eventType (AC-E2.4в).
  const [primaryEventPrefs, secondaryEventPrefs] = await Promise.all([
    tx.notificationEventPreference.findMany({ where: { userId: primaryId }, select: { eventType: true } }),
    tx.notificationEventPreference.findMany({ where: { userId: secondaryId }, select: { id: true, eventType: true } }),
  ]);
  moved.notificationEventPrefs = await moveDeduped({
    primaryKeys: new Set(primaryEventPrefs.map((p) => p.eventType)),
    secondaryRows: secondaryEventPrefs,
    key: (p) => p.eventType,
    remove: (ids) => tx.notificationEventPreference.deleteMany({ where: { id: { in: ids } } }),
    move: () =>
      tx.notificationEventPreference.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
  });

  // ── 9. NotificationGlobalPreference: userId is the PK (copy, then delete).
  const primaryGlobalPref = await tx.notificationGlobalPreference.findUnique({
    where: { userId: primaryId },
    select: { userId: true },
  });
  if (primaryGlobalPref) {
    await tx.notificationGlobalPreference.deleteMany({ where: { userId: secondaryId } });
  } else {
    const sec = await tx.notificationGlobalPreference.findUnique({ where: { userId: secondaryId } });
    if (sec) {
      await tx.notificationGlobalPreference.create({
        data: {
          userId: primaryId,
          timezone: sec.timezone,
          quietHoursFrom: sec.quietHoursFrom,
          quietHoursTo: sec.quietHoursTo,
          dndUntil: sec.dndUntil,
          feedSeenAt: sec.feedSeenAt,
        },
      });
      await tx.notificationGlobalPreference.delete({ where: { userId: secondaryId } });
      moved.notificationGlobalPref = 1;
    }
  }

  // ── 10. OutgoingNotification.userId (plain column) — after step 7.
  moved.outgoingNotifications = (
    await tx.outgoingNotification.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } })
  ).count;

  // ── 11. Module recipient lists: secondary → primary without duplicates (AC-E2.6).
  //     Only lists the primary is admitted to (its own role and assignments —
  //     the secondary's rights were dropped in step 3).
  const [secondaryLists, primaryAssignments] = await Promise.all([
    tx.moduleNotificationRecipient.findMany({
      where: { userId: secondaryId },
      select: { moduleSlug: true, createdByUserId: true, createdAt: true },
    }),
    tx.moduleAssignment.findMany({ where: { userId: primaryId }, select: { module: { select: { slug: true } } } }),
  ]);
  const primaryAssigned = new Set(primaryAssignments.map((a) => a.module.slug));
  const transferableLists = secondaryLists.filter((l) =>
    admittedToRecipientList(primary.role, primaryAssigned, l.moduleSlug),
  );
  if (secondaryLists.length > 0) {
    const created = await tx.moduleNotificationRecipient.createMany({
      data: transferableLists.map((l) => ({
        moduleSlug: l.moduleSlug,
        userId: primaryId,
        createdByUserId: l.createdByUserId,
        createdAt: l.createdAt,
      })),
      skipDuplicates: true,
    });
    await tx.moduleNotificationRecipient.deleteMany({ where: { userId: secondaryId } });
    moved.recipientLists = created.count;
  }

  // ── 12. Chats: participant dedup by chat, receipt dedup by message.
  const [primaryParticipations, secondaryParticipations] = await Promise.all([
    tx.chatParticipant.findMany({ where: { userId: primaryId }, select: { chatId: true } }),
    tx.chatParticipant.findMany({ where: { userId: secondaryId }, select: { id: true, chatId: true } }),
  ]);
  moved.chatParticipants = await moveDeduped({
    primaryKeys: new Set(primaryParticipations.map((p) => p.chatId)),
    secondaryRows: secondaryParticipations,
    key: (p) => p.chatId,
    remove: (ids) => tx.chatParticipant.deleteMany({ where: { id: { in: ids } } }),
    move: () => tx.chatParticipant.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
  });

  const secondaryReceipts = await tx.chatMessageReceipt.findMany({
    where: { userId: secondaryId },
    select: { messageId: true },
  });
  if (secondaryReceipts.length > 0) {
    const messageIds = secondaryReceipts.map((r) => r.messageId);
    const overlapping = await tx.chatMessageReceipt.findMany({
      where: { userId: primaryId, messageId: { in: messageIds } },
      select: { messageId: true },
    });
    if (overlapping.length > 0) {
      await tx.chatMessageReceipt.deleteMany({
        where: { userId: secondaryId, messageId: { in: overlapping.map((r) => r.messageId) } },
      });
    }
    moved.chatReceipts = (
      await tx.chatMessageReceipt.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } })
    ).count;
  }

  // ── 13. Merge queue: this pair → RESOLVED_MERGED, other open ones with the
  // secondary → DISMISSED.
  const resolved = await tx.mergeCandidate.updateMany({
    where: {
      OR: [
        { primaryUserId: primaryId, candidateUserId: secondaryId },
        { primaryUserId: secondaryId, candidateUserId: primaryId },
      ],
    },
    data: { status: "RESOLVED_MERGED", resolvedAt: now, resolvedByUserId: actorId },
  });
  const dismissed = await tx.mergeCandidate.updateMany({
    where: { status: "PENDING", OR: [{ primaryUserId: secondaryId }, { candidateUserId: secondaryId }] },
    data: { status: "DISMISSED", resolvedAt: now, resolvedByUserId: actorId },
  });
  moved.mergeCandidatesResolved = resolved.count;
  moved.mergeCandidatesDismissed = dismissed.count;

  // ── 14. Bot contact: the surviving Telegram keeps the earlier first start
  // (AC-E1.3/AC-E2.6); its own block state stays (it is the actual one).
  if (telegramConflict && primary.telegramId && secondary.telegramId) {
    const [pc, sc] = await Promise.all([
      tx.telegramBotContact.findUnique({ where: { telegramId: primary.telegramId } }),
      tx.telegramBotContact.findUnique({ where: { telegramId: secondary.telegramId } }),
    ]);
    // Only an earlier date for a Telegram that has itself reached the bot —
    // never «Бот запущен» for an account that never wrote to it (delivery
    // would fail while the screens promise it works).
    const primaryReached = Boolean(pc && (pc.startedAt || pc.startedBackfill || pc.lastDeliveryOkAt));
    const earlier = earliest(pc?.startedAt, sc?.startedAt);
    if (pc && primaryReached && earlier && earlier !== pc.startedAt) {
      await tx.telegramBotContact.update({
        where: { telegramId: primary.telegramId },
        data: { startedAt: earlier },
      });
    }
  }

  // ── 15. Free the secondary's unique fields, demote, tombstone — FIRST…
  await tx.user.update({
    where: { id: secondaryId },
    data: {
      email: null,
      phone: null,
      telegramId: null,
      vkId: null,
      phoneNormalized: null,
      emailNormalized: null,
      role: "USER",
      mergedIntoUserId: primaryId,
      mergedAt: now,
    },
  });
  await bumpSessionVersion(tx, secondaryId);

  // ── 16. …THEN fill the primary's empty fields (primary wins, AC-E2.4г).
  const fill: Prisma.UserUpdateInput = {};
  const transferredFields: string[] = [];
  if (!primary.name && secondary.name) {
    fill.name = secondary.name;
    transferredFields.push("name");
  }
  if (!primary.image && secondary.image) {
    fill.image = secondary.image;
    transferredFields.push("image");
  }
  if (!primary.phone && secondary.phone) {
    fill.phone = secondary.phone;
    fill.phoneNormalized = secondary.phoneNormalized;
    transferredFields.push("phone");
  }
  if (!primary.email && secondary.email) {
    fill.email = secondary.email;
    fill.emailNormalized = secondary.emailNormalized;
    if (!primary.emailVerified && secondary.emailVerified) fill.emailVerified = secondary.emailVerified;
    // The password belongs to the email credential — «основной входит и по
    // email» (AC-E2.6) keeps working with the same password.
    if (!primary.passwordHash && secondary.passwordHash) fill.passwordHash = secondary.passwordHash;
    transferredFields.push("email");
  }
  if (!primary.telegramId && secondary.telegramId) {
    fill.telegramId = secondary.telegramId;
    transferredFields.push("telegram");
  }
  if (!primary.vkId && secondary.vkId) {
    fill.vkId = secondary.vkId;
    transferredFields.push("vk");
  }
  if (Object.keys(fill).length > 0) {
    await tx.user.update({ where: { id: primaryId }, data: fill });
  }

  // The Telegram that moved in starts delivering to a staff primary right away;
  // without the channel row the team screen keeps «Нет рабочего канала» until
  // the person opens the Center in the Mini App (ensureTelegramChannel).
  if (fill.telegramId && primary.role !== "USER" && secondary.telegramId) {
    const existing = await tx.userNotificationChannel.findFirst({
      where: { userId: primaryId, kind: "TELEGRAM", address: secondary.telegramId },
      select: { id: true },
    });
    if (!existing) {
      await tx.userNotificationChannel.create({
        data: {
          userId: primaryId,
          kind: "TELEGRAM",
          address: secondary.telegramId,
          label: "Telegram",
          priority: 10,
          isActive: true,
          verifiedAt: now,
        },
      });
    }
  }

  // ── 17. AuditLog (AC-E2.8): actor, both accounts, resulting role, counters,
  // resolved conflicts and the dropped secondary rights.
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: MERGE_AUDIT_ACTIONS[mode],
      entity: "User",
      entityId: primaryId,
      metadata: {
        mode,
        source: mode === "self_link" ? "self_link" : "admin_ui",
        primaryId,
        secondaryId,
        secondaryName: secondary.name,
        secondaryEmail: secondary.email,
        resultingRole: primary.role,
        secondaryRole: secondary.role,
        transferredFields,
        conflicts,
        telegramConflictConfirmed: telegramConflict ? Boolean(input.confirmTelegramConflict) : null,
        droppedSecondaryRights: {
          role: secondary.role === "USER" ? null : secondary.role,
          sections: droppedGrants.map((g) => g.section),
          modules: droppedAssignments.map((a) => a.module.slug),
        },
        fkMoved: moved,
      },
    },
  });

  return { primaryId, tombstonedUserId: secondaryId, resultingRole: primary.role, moved };
}

/**
 * Merge `secondaryId` into `primaryId` (ADR §Q6). Throws `DomainError`
 * (`ALREADY_MERGED`, `SECONDARY_IS_ACTOR`, `SECONDARY_SEEDED_SUPERADMIN`,
 * `LAST_SUPERADMIN`, `TELEGRAM_CONFLICT_UNCONFIRMED`,
 * `ACTIVE_SUBSCRIPTION_CONFLICT`, `USER_NOT_FOUND`, `SAME_ACCOUNT`); mode
 * `clients_only` keeps the legacy plain-Error texts. After commit the
 * secondary's auth state is published — its sessions die on the next request,
 * the primary's session is untouched (AC-E2.9).
 */
export async function mergeAccounts(input: {
  primaryId: string;
  secondaryId: string;
  actorId: string;
  mode: MergeMode;
  confirmTelegramConflict?: boolean;
}): Promise<AccountMergeResult> {
  if (input.primaryId === input.secondaryId) {
    throw input.mode === "clients_only" ? new Error(LEGACY.same) : mergeError("SAME_ACCOUNT");
  }
  if (input.mode !== "clients_only" && input.secondaryId === input.actorId) {
    throw mergeError("SECONDARY_IS_ACTOR");
  }
  if (input.mode !== "clients_only" && (input.primaryId === SYSTEM_USER_ID || input.secondaryId === SYSTEM_USER_ID)) {
    throw mergeError("USER_NOT_FOUND");
  }

  const result = await prisma.$transaction((tx) => runMerge(tx, input), MERGE_TX_OPTIONS);
  await publishAuthState(input.secondaryId);
  return result;
}

// ─── Legacy wrappers (clients CRM, autoMergeOnLogin) ────────────────────────

/**
 * Merge `secondary` USER into `primary` USER — the clients CRM entry point
 * (`/api/admin/clients/merge`, `autoMergeOnLogin`). Thin wrapper over
 * `mergeAccounts` in mode `clients_only`: both must be clients, legacy error
 * texts; the secondary is tombstoned, never deleted.
 */
export async function mergeClients(
  primaryId: string,
  secondaryId: string,
  performedById: string,
): Promise<MergeResult> {
  const result = await mergeAccounts({ primaryId, secondaryId, actorId: performedById, mode: "clients_only" });
  return {
    primaryId: result.primaryId,
    merged: result.moved,
    // `deletedUserId` kept for backwards compat with old route consumers;
    // the user is tombstoned, not deleted.
    deletedUserId: result.tombstonedUserId,
    tombstonedUserId: result.tombstonedUserId,
  };
}

/** Legacy clients-CRM preview (old shape and texts). */
export async function previewMerge(primaryId: string, secondaryId: string): Promise<MergePreview> {
  const select = {
    id: true,
    name: true,
    email: true,
    phone: true,
    telegramId: true,
    role: true,
    _count: { select: { bookings: true, orders: true } },
  } satisfies Prisma.UserSelect;
  const [primary, secondary] = await Promise.all([
    prisma.user.findUnique({ where: { id: primaryId }, select }),
    prisma.user.findUnique({ where: { id: secondaryId }, select }),
  ]);

  if (!primary) throw new Error(LEGACY.primaryMissing);
  if (!secondary) throw new Error(LEGACY.secondaryMissing);
  if (primary.role !== "USER") throw new Error(LEGACY.primaryNotClient);
  if (secondary.role !== "USER") throw new Error(LEGACY.secondaryNotClient);

  const conflicts: string[] = [];
  if (primary.email && secondary.email && primary.email !== secondary.email) {
    conflicts.push(`У обоих клиентов есть email — будет использован email основного (${primary.email})`);
  }
  if (primary.phone && secondary.phone && primary.phone !== secondary.phone) {
    conflicts.push(`У обоих клиентов есть телефон — будет использован телефон основного (${primary.phone})`);
  }
  if (primary.telegramId && secondary.telegramId && primary.telegramId !== secondary.telegramId) {
    conflicts.push(`У обоих клиентов есть Telegram — будет использован TG основного`);
  }

  const card = (u: typeof primary) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    telegramId: u.telegramId,
    bookingCount: u._count.bookings,
    orderCount: u._count.orders,
  });
  return { primary: card(primary), secondary: card(secondary), conflicts };
}

// ─── Search (merge wizard step 1) ───────────────────────────────────────────

/**
 * Accounts to merge with (AC-E2.1): by name / email / phone / Telegram ID,
 * non-merged, without the `system` user, ≤ 20. The response never carries
 * the Telegram ID itself — only `hasTelegram`.
 */
export async function searchMergeCandidates(q: string, exclude?: string) {
  const query = q.trim();
  const digits = query.replace(/\D/g, "");
  const or: Prisma.UserWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
    { phone: { contains: query } },
  ];
  if (digits.length >= 4) {
    or.push({ phoneNormalized: { contains: digits } });
    or.push({ telegramId: digits });
  }
  const rows = await prisma.user.findMany({
    where: {
      mergedIntoUserId: null,
      id: { notIn: exclude ? [SYSTEM_USER_ID, exclude] : [SYSTEM_USER_ID] },
      OR: or,
    },
    select: { id: true, name: true, role: true, email: true, phone: true, telegramId: true },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    take: 20,
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    email: u.email,
    phone: u.phone,
    hasTelegram: Boolean(u.telegramId),
  }));
}
