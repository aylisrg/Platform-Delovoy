import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ADMIN_EDITABLE_MODULES,
  ADMIN_SECTIONS,
  STRICT_ACCESS_MODULES,
  computeAdminSections,
} from "@/lib/permissions";
import { isSeededSuperadmin } from "@/lib/seeded-superadmin";
import { explainStaffNotifications, moduleLabel, type StaffNotificationExplain } from "@/modules/notifications/explain";
import {
  computeBotStatus,
  getBotContacts,
  getBotTrackingSince,
  toBotStatusDto,
  type BotStatusDto,
} from "@/modules/telegram-link/bot-contact";
import { countPendingMergeRequests, MERGE_REQUEST_REASON_FIELD } from "@/modules/clients/merge-requests";
import { DomainError } from "./errors";

/**
 * Team review screens (US-B1/B2): the «Команда» tab and the staff page.
 * Everything about notifications comes from `explainStaffNotifications` — the
 * same rules the delivery uses (ADR 2026-10-25-team-access-notifications §Q7).
 */

const TEAM_ROLES: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER"];
const SYSTEM_USER_ID = "system";
export const STALE_LOGIN_DAYS = 90;

const SECTION_LABELS = new Map<string, string>(ADMIN_SECTIONS.map((s) => [s.slug, s.label]));
const ADMIN_OWNED = new Set<string>(ADMIN_EDITABLE_MODULES);

export type SectionSource = "role" | "grant" | "strict_grant";
export type SectionAccess = { slug: string; label: string; source: SectionSource };

export type TeamFlag = "NO_WORKING_CHANNEL" | "BOT_NOT_STARTED" | "BOT_BLOCKED" | "STALE_LOGIN" | "NO_SECTIONS";

export type TeamOverviewRow = {
  id: string;
  name: string | null;
  image: string | null;
  role: "SUPERADMIN" | "ADMIN" | "MANAGER";
  email: string | null;
  emailVerified: boolean;
  hasTelegram: boolean;
  botStatus: BotStatusDto;
  sections: SectionAccess[];
  modules: Array<{ slug: string; name: string }>;
  subscriptions: { active: number; available: number };
  releases: boolean;
  lastLoginAt: string | null;
  flags: TeamFlag[];
  isSeededSuperadmin: boolean;
};

export type TeamOverviewQuery = {
  role?: "SUPERADMIN" | "ADMIN" | "MANAGER";
  problems?: boolean;
  bot?: "not_started" | "blocked";
  noTelegram?: boolean;
  sort?: "lastLogin" | "name";
};

/** Effective sections with where they come from (AC-B1.4). */
export function describeSections(role: Role, grants: string[]): SectionAccess[] {
  return computeAdminSections(role, grants).map((slug) => {
    let source: SectionSource = "grant";
    if (STRICT_ACCESS_MODULES.has(slug)) source = "strict_grant";
    else if (role === "SUPERADMIN") source = "role";
    else if (role === "ADMIN" && ADMIN_OWNED.has(slug) && !grants.includes(slug)) source = "role";
    return { slug, label: SECTION_LABELS.get(slug) ?? slug, source };
  });
}

const CHANNEL_BLOCKERS = new Set(["NO_CHANNEL", "BOT_NOT_STARTED", "BOT_BLOCKED", "CHANNEL_DISABLED"]);

/** «N из M»: M — events with access in some context, N — events with a delivery route. */
export function countSubscriptions(explain: StaffNotificationExplain): { active: number; available: number } {
  const events = explain.categories.flatMap((c) => c.events);
  return {
    active: events.filter((e) => e.status === "RECEIVES" || e.status === "BLOCKED").length,
    available: events.filter((e) => e.status !== "NO_ACCESS").length,
  };
}

export function teamFlags(input: {
  role: Role;
  sections: SectionAccess[];
  lastLoginAt: Date | null;
  botStatus: BotStatusDto;
  explain: StaffNotificationExplain;
  now: Date;
}): TeamFlag[] {
  const flags: TeamFlag[] = [];
  const events = input.explain.categories.flatMap((c) => c.events);
  if (events.some((e) => e.status === "BLOCKED" && e.blockers.some((b) => CHANNEL_BLOCKERS.has(b.code)))) {
    flags.push("NO_WORKING_CHANNEL");
  }
  if (input.botStatus.state === "NOT_STARTED") flags.push("BOT_NOT_STARTED");
  if (input.botStatus.state === "BLOCKED") flags.push("BOT_BLOCKED");
  const staleBefore = input.now.getTime() - STALE_LOGIN_DAYS * 24 * 60 * 60 * 1000;
  if (!input.lastLoginAt || input.lastLoginAt.getTime() < staleBefore) flags.push("STALE_LOGIN");
  if (input.role === "MANAGER" && input.sections.length === 0) flags.push("NO_SECTIONS");
  return flags;
}

export async function getTeamOverview(
  q: TeamOverviewQuery = {},
  now: Date = new Date(),
): Promise<{ rows: TeamOverviewRow[]; pendingMergeRequests: number }> {
  const [users, pendingMergeRequests] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: q.role ? q.role : { in: TEAM_ROLES },
        mergedIntoUserId: null,
        id: { not: SYSTEM_USER_ID },
      },
      select: {
        id: true,
        name: true,
        image: true,
        role: true,
        email: true,
        emailVerified: true,
        telegramId: true,
        lastLoginAt: true,
        adminPermissions: { select: { section: true } },
        moduleAssignments: { select: { module: { select: { slug: true, name: true } } } },
      },
    }),
    // Same definition as the merge-request queue panel (telegramId conflicts only).
    countPendingMergeRequests(),
  ]);

  const explains = await explainStaffNotifications(users.map((u) => u.id), now);

  let rows = users.flatMap<TeamOverviewRow>((u) => {
    const explain = explains.get(u.id);
    if (!explain) return [];
    const sections = describeSections(u.role, u.adminPermissions.map((p) => p.section));
    const release = explain.categories.flatMap((c) => c.events).find((e) => e.eventType === "system.release");
    return [
      {
        id: u.id,
        name: u.name,
        image: u.image,
        role: u.role as TeamOverviewRow["role"],
        email: u.email,
        emailVerified: u.emailVerified !== null,
        hasTelegram: Boolean(u.telegramId),
        botStatus: explain.botStatus,
        sections,
        modules: u.moduleAssignments.map((a) => ({ slug: a.module.slug, name: a.module.name })),
        subscriptions: countSubscriptions(explain),
        releases: release?.toggle.enabled ?? false,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        flags: teamFlags({ role: u.role, sections, lastLoginAt: u.lastLoginAt, botStatus: explain.botStatus, explain, now }),
        isSeededSuperadmin: isSeededSuperadmin(u),
      },
    ];
  });

  if (q.problems) rows = rows.filter((r) => r.flags.length > 0);
  if (q.bot === "not_started") rows = rows.filter((r) => r.botStatus.state === "NOT_STARTED");
  if (q.bot === "blocked") rows = rows.filter((r) => r.botStatus.state === "BLOCKED");
  if (q.noTelegram) rows = rows.filter((r) => !r.hasTelegram);

  const roleRank: Record<string, number> = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2 };
  rows.sort((a, b) => {
    if (q.sort === "lastLogin") {
      return (b.lastLoginAt ?? "").localeCompare(a.lastLoginAt ?? "");
    }
    return roleRank[a.role] - roleRank[b.role] || (a.name ?? "").localeCompare(b.name ?? "", "ru");
  });

  return { rows, pendingMergeRequests };
}

// ─── Staff page ─────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  telegram_bot: "Telegram-бот",
  vk_id: "VK ID",
  email: "Сайт (email)",
  import: "Импорт",
  legacy: "Старый сайт",
};

export type UserOverview =
  | { kind: "merged"; primaryUserId: string }
  | {
      kind: "user";
      user: {
        id: string;
        name: string | null;
        image: string | null;
        role: Role;
        createdAt: string;
        source: string | null;
        sourceLabel: string;
        lastLoginAt: string | null;
        isTeamMember: boolean;
        isSeededSuperadmin: boolean;
      };
      contacts: {
        email: string | null;
        emailVerified: boolean;
        phone: string | null;
        telegramLinked: boolean;
        vkLinked: boolean;
        authMethods: string[];
        botStatus: BotStatusDto;
      };
      access: {
        sections: SectionAccess[];
        strictSections: Array<{ slug: string; label: string; granted: boolean }>;
        modules: Array<{ slug: string; name: string }>;
        recipientLists: Array<{ moduleSlug: string; label: string }>;
      };
      actions: {
        canExclude: boolean;
        canMerge: true;
        canResetPassword: boolean;
        canChangeRole: boolean;
        canDelete: boolean;
      };
      possibleDuplicates: Array<{
        userId: string;
        name: string | null;
        role: Role;
        reason: "phone" | "merge_request";
        mergeRequestId?: string;
      }>;
    };

export async function getUserOverview(userId: string, actorId: string): Promise<UserOverview> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      image: true,
      role: true,
      createdAt: true,
      source: true,
      lastLoginAt: true,
      mergedIntoUserId: true,
      email: true,
      emailVerified: true,
      phone: true,
      phoneNormalized: true,
      telegramId: true,
      vkId: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
      adminPermissions: { select: { section: true } },
      moduleAssignments: { select: { module: { select: { slug: true, name: true } } } },
      notificationRecipientOf: { select: { moduleSlug: true } },
    },
  });
  if (!user || user.id === SYSTEM_USER_ID) throw new DomainError("USER_NOT_FOUND", "Пользователь не найден", 404);
  if (user.mergedIntoUserId) return { kind: "merged", primaryUserId: user.mergedIntoUserId };

  const [contacts, trackingSince, phoneTwins, requests] = await Promise.all([
    getBotContacts(user.telegramId ? [user.telegramId] : []),
    getBotTrackingSince(),
    user.phoneNormalized
      ? prisma.user.findMany({
          where: { phoneNormalized: user.phoneNormalized, mergedIntoUserId: null, id: { not: user.id } },
          select: { id: true, name: true, role: true },
          take: 10,
        })
      : Promise.resolve([]),
    prisma.mergeCandidate.findMany({
      where: {
        status: "PENDING",
        matchedFields: { has: MERGE_REQUEST_REASON_FIELD },
        OR: [{ primaryUserId: user.id }, { candidateUserId: user.id }],
      },
      select: {
        id: true,
        primary: { select: { id: true, name: true, role: true, mergedIntoUserId: true } },
        candidate: { select: { id: true, name: true, role: true, mergedIntoUserId: true } },
      },
      take: 10,
    }),
  ]);

  const botStatus = toBotStatusDto(
    computeBotStatus(user.telegramId, user.telegramId ? contacts.get(user.telegramId) : null, trackingSince),
  );
  const grants = user.adminPermissions.map((p) => p.section);
  const isTeamMember = TEAM_ROLES.includes(user.role);

  const authMethods: string[] = [];
  if (user.telegramId) authMethods.push("telegram");
  if (user.email && user.passwordHash) authMethods.push("credentials");
  for (const acc of user.accounts) if (!authMethods.includes(acc.provider)) authMethods.push(acc.provider);

  const duplicates: Extract<UserOverview, { kind: "user" }>["possibleDuplicates"] = [];
  for (const req of requests) {
    const other = req.primary.id === user.id ? req.candidate : req.primary;
    if (other.mergedIntoUserId) continue;
    duplicates.push({ userId: other.id, name: other.name, role: other.role, reason: "merge_request", mergeRequestId: req.id });
  }
  for (const twin of phoneTwins) {
    if (!duplicates.some((d) => d.userId === twin.id)) {
      duplicates.push({ userId: twin.id, name: twin.name, role: twin.role, reason: "phone" });
    }
  }

  return {
    kind: "user",
    user: {
      id: user.id,
      name: user.name,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      source: user.source,
      sourceLabel: user.source ? (SOURCE_LABELS[user.source] ?? user.source) : "Не указан",
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      isTeamMember,
      isSeededSuperadmin: isSeededSuperadmin(user),
    },
    contacts: {
      email: user.email,
      emailVerified: user.emailVerified !== null,
      phone: user.phone,
      telegramLinked: Boolean(user.telegramId),
      vkLinked: Boolean(user.vkId),
      authMethods,
      botStatus,
    },
    access: {
      sections: describeSections(user.role, grants),
      strictSections: [...STRICT_ACCESS_MODULES].map((slug) => ({
        slug,
        label: SECTION_LABELS.get(slug) ?? slug,
        granted: grants.includes(slug),
      })),
      modules: user.moduleAssignments.map((a) => ({ slug: a.module.slug, name: a.module.name })),
      recipientLists: user.notificationRecipientOf.map((r) => ({ moduleSlug: r.moduleSlug, label: moduleLabel(r.moduleSlug) })),
    },
    actions: {
      canExclude: isTeamMember && user.id !== actorId,
      canMerge: true,
      canResetPassword: Boolean(user.email),
      canChangeRole: user.id !== actorId,
      canDelete: user.id !== actorId,
    },
    possibleDuplicates: duplicates,
  };
}
