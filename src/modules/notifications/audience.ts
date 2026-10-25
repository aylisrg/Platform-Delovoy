import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MANAGED_EVENT_TYPES } from "./catalog";
import {
  AVITO_EVENT,
  TELEPHONY_EVENT,
  evaluateRoute,
  groupChatDecision,
  type DeliveryPath,
  type StaffSnapshot,
} from "./audience-rules";
import { getGlobalAdminChatId, getModuleBotConfig } from "./module-chat-config";

/**
 * DB side of the single staff-notification resolver
 * (ADR 2026-10-25-team-access-notifications §Q7): batch-loads snapshots and
 * applies `evaluateRoute`. Used by real delivery (notifyAdmin, Avito leads,
 * releases, telephony summaries) and by the screens (via `explain.ts`).
 */

type Db = PrismaClient | Prisma.TransactionClient;

const STAFF_ROLES: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER"];

const SNAPSHOT_SELECT = {
  id: true,
  role: true,
  mergedIntoUserId: true,
  adminPermissions: { select: { section: true } },
  moduleAssignments: { select: { module: { select: { slug: true } } } },
  notificationEventPrefs: {
    where: { eventType: { in: MANAGED_EVENT_TYPES as string[] } },
    select: { eventType: true, enabled: true },
  },
  notificationRecipientOf: { select: { moduleSlug: true } },
} satisfies Prisma.UserSelect;

type SnapshotRow = Prisma.UserGetPayload<{ select: typeof SNAPSHOT_SELECT }>;

export function toStaffSnapshot(row: SnapshotRow): StaffSnapshot {
  return {
    id: row.id,
    role: row.role,
    merged: row.mergedIntoUserId !== null,
    grants: new Set(row.adminPermissions.map((p) => p.section)),
    assignments: new Set(row.moduleAssignments.map((a) => a.module.slug)),
    prefs: new Map(row.notificationEventPrefs.map((p) => [p.eventType, { enabled: p.enabled }])),
    listModules: new Set(row.notificationRecipientOf.map((r) => r.moduleSlug)),
  };
}

async function candidateUserIds(
  eventType: string,
  moduleSlug: string | null,
  db: Db,
): Promise<string[]> {
  const activeStaff = { role: { in: STAFF_ROLES }, mergedIntoUserId: null };
  const [prefRows, listRows, roleRows] = await Promise.all([
    db.notificationEventPreference.findMany({
      where: { eventType, user: activeStaff },
      select: { userId: true },
    }),
    moduleSlug && eventType !== AVITO_EVENT
      ? db.moduleNotificationRecipient.findMany({
          where: { moduleSlug, user: activeStaff },
          select: { userId: true },
        })
      : Promise.resolve([]),
    eventType === AVITO_EVENT || eventType === TELEPHONY_EVENT
      ? db.user.findMany({
          where: {
            ...activeStaff,
            OR: [
              { role: "SUPERADMIN" },
              ...(eventType === AVITO_EVENT && moduleSlug
                ? [{ role: { in: ["MANAGER", "ADMIN"] as Role[] }, moduleAssignments: { some: { module: { slug: moduleSlug } } } }]
                : []),
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  return [
    ...new Set([
      ...prefRows.map((r) => r.userId),
      ...listRows.map((r) => r.userId),
      ...roleRows.map((r) => r.id),
    ]),
  ];
}

/**
 * Snapshots for explicit `userIds`, or for every possible recipient of
 * `eventType` in `moduleSlug` (preference rows ∪ recipient list ∪ role-based).
 */
export async function loadStaffSnapshots(
  where: { userIds?: string[]; eventType?: string; moduleSlug?: string | null },
  db: Db = prisma,
): Promise<StaffSnapshot[]> {
  const ids =
    where.userIds ?? (where.eventType ? await candidateUserIds(where.eventType, where.moduleSlug ?? null, db) : []);
  if (ids.length === 0) return [];
  const rows = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: SNAPSHOT_SELECT });
  return rows.map(toStaffSnapshot);
}

export type StaffRouting = {
  recipients: Array<{ userId: string; paths: DeliveryPath[] }>;
  /** Would receive, but explicitly turned it off — recorded as a skip. */
  suppressed: Array<{ userId: string; reason: "OPTED_OUT" }>;
  groupChat: { send: boolean; chatId?: string; botToken?: string; reason: string };
};

/**
 * Who gets a staff event, and whether the module group chat does.
 * One message per person regardless of how many paths they have (AC-C1.3).
 * `staffAudience: "personal"` keeps only explicit personal subscriptions.
 * `withGroupChat` evaluates the legacy group-chat paths (notifyAdmin only).
 */
export async function resolveStaffRouting(
  input: {
    eventType: string;
    moduleSlug: string | null;
    staffAudience?: "personal";
    userIds?: string[];
    withGroupChat?: boolean;
  },
  db: Db = prisma,
): Promise<StaffRouting> {
  const snapshots = await loadStaffSnapshots(
    { userIds: input.userIds, eventType: input.eventType, moduleSlug: input.moduleSlug },
    db,
  );

  const recipients: StaffRouting["recipients"] = [];
  const suppressed: StaffRouting["suppressed"] = [];
  for (const snapshot of snapshots) {
    const decision = evaluateRoute(snapshot, input.eventType, input.moduleSlug);
    const paths =
      input.staffAudience === "personal" ? decision.paths.filter((p) => p === "personal") : decision.paths;
    if (paths.length === 0) continue;
    if (decision.optedOut) suppressed.push({ userId: snapshot.id, reason: "OPTED_OUT" });
    else recipients.push({ userId: snapshot.id, paths });
  }

  let groupChat: StaffRouting["groupChat"] = { send: false, reason: "not_applicable" };
  if (input.withGroupChat && input.moduleSlug) {
    groupChat = await resolveGroupChat(input.moduleSlug, input.staffAudience, db);
  }

  return { recipients, suppressed, groupChat };
}

/** Group chat for one module context — same decision the delivery takes. */
export async function resolveGroupChat(
  moduleSlug: string,
  staffAudience: "personal" | undefined,
  db: Db = prisma,
): Promise<StaffRouting["groupChat"]> {
  const [config, listRowCount] = await Promise.all([
    getModuleBotConfig(moduleSlug),
    db.moduleNotificationRecipient.count({ where: { moduleSlug } }),
  ]);
  const chatEnabled = config.telegramAdminChatEnabled !== false;
  const needsGlobal =
    staffAudience !== "personal" && chatEnabled && listRowCount === 0 && !config.telegramAdminChatId;
  const decision = groupChatDecision({
    staffAudience,
    chatEnabled,
    listRowCount,
    moduleChatId: config.telegramAdminChatId,
    globalChatId: needsGlobal ? await getGlobalAdminChatId() : undefined,
  });
  return { ...decision, botToken: config.telegramBotToken };
}
