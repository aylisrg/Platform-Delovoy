import type { Role } from "@prisma/client";
import type { Mock } from "vitest";

/**
 * In-memory answers for exactly the queries the recipient resolver
 * (`audience.ts`) makes, so tests exercise the REAL routing rules instead of
 * mocking them away (ADR 2026-10-25-team-access-notifications §Q7, AC-C1.6).
 */
export type StaffFixture = {
  id: string;
  role: Role;
  merged?: boolean;
  grants?: string[];
  assignments?: string[];
  /** Assignments to deactivated modules — visible only to queries that don't filter `isActive`. */
  inactiveAssignments?: string[];
  prefs?: Record<string, boolean>;
  lists?: string[];
};

type PrismaLike = {
  user: { findMany: Mock };
  notificationEventPreference: { findMany: Mock };
  moduleNotificationRecipient: { findMany: Mock; count: Mock };
};

const STAFF: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER"];
const isActiveStaff = (s: StaffFixture) => STAFF.includes(s.role) && !s.merged;

type OrClause = {
  role?: Role | { in: Role[] };
  moduleAssignments?: { some: { module: { slug: string; isActive?: boolean } } };
};

function assignedSlugs(s: StaffFixture, activeOnly: boolean): string[] {
  return activeOnly ? (s.assignments ?? []) : [...(s.assignments ?? []), ...(s.inactiveAssignments ?? [])];
}

function matchesOr(clause: OrClause, s: StaffFixture): boolean {
  if (typeof clause.role === "string" && clause.role !== s.role) return false;
  if (clause.role && typeof clause.role === "object" && !clause.role.in.includes(s.role)) return false;
  const wanted = clause.moduleAssignments?.some.module;
  if (wanted && !assignedSlugs(s, wanted.isActive === true).includes(wanted.slug)) return false;
  return true;
}

export function toSnapshotRow(s: StaffFixture, activeAssignmentsOnly = true) {
  return {
    id: s.id,
    role: s.role,
    mergedIntoUserId: s.merged ? "primary" : null,
    adminPermissions: (s.grants ?? []).map((section) => ({ section })),
    moduleAssignments: assignedSlugs(s, activeAssignmentsOnly).map((slug) => ({ module: { slug } })),
    notificationEventPrefs: Object.entries(s.prefs ?? {}).map(([eventType, enabled]) => ({ eventType, enabled })),
    notificationRecipientOf: (s.lists ?? []).map((moduleSlug) => ({ moduleSlug })),
  };
}

export function installStaffFixtures(prisma: PrismaLike, getStaff: () => StaffFixture[]): void {
  prisma.notificationEventPreference.findMany.mockImplementation(
    async ({ where }: { where: { eventType?: string; user?: unknown } }) =>
      getStaff()
        .filter((s) => where.eventType !== undefined && s.prefs && where.eventType in s.prefs)
        .filter((s) => !where.user || isActiveStaff(s))
        .map((s) => ({ userId: s.id })),
  );
  prisma.moduleNotificationRecipient.findMany.mockImplementation(
    async ({ where }: { where: { moduleSlug: string; user?: unknown } }) =>
      getStaff()
        .filter((s) => (s.lists ?? []).includes(where.moduleSlug))
        .filter((s) => !where.user || isActiveStaff(s))
        .map((s) => ({ userId: s.id })),
  );
  prisma.moduleNotificationRecipient.count.mockImplementation(
    async ({ where }: { where: { moduleSlug: string } }) =>
      getStaff().filter((s) => (s.lists ?? []).includes(where.moduleSlug)).length,
  );
  prisma.user.findMany.mockImplementation(
    async ({
      where,
      select,
    }: {
      where?: { id?: { in: string[] }; OR?: OrClause[] };
      select?: { moduleAssignments?: { where?: { module?: { isActive?: boolean } } } };
    }) => {
      if (where?.id?.in) {
        const ids = where.id.in;
        const activeOnly = select?.moduleAssignments?.where?.module?.isActive === true;
        return getStaff()
          .filter((s) => ids.includes(s.id))
          .map((s) => toSnapshotRow(s, activeOnly));
      }
      const ors = where?.OR ?? [];
      return getStaff()
        .filter((s) => isActiveStaff(s) && ors.some((clause) => matchesOr(clause, s)))
        .map((s) => ({ id: s.id }));
    },
  );
}
