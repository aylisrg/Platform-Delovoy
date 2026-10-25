import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ADMIN_SECTIONS,
  ADMIN_SECTION_SLUGS,
  SUPERADMIN_ONLY_SECTIONS,
  getGrantableSections,
} from "@/lib/permissions";
import { bumpSessionVersion, publishAuthState } from "@/lib/session-revocation";
import { DomainError, USER_ERROR_MESSAGES, userNotFound } from "./errors";
import type { SectionOption, UserPermissionsUpdateResult, UserPermissionsView } from "./types";

/**
 * The «Права» modal (ADR 2026-10-25-team-access-notifications §6.2, PRD US-A4).
 *
 * Three groups per role (`getGrantableSections`): read-only «Доступны по роли»,
 * «Можно выдать», «Особый доступ» (strict, explicit grant for everyone). Saving
 * replaces explicit grants only inside grantable ∪ strict of the target's role;
 * any other AdminPermission rows are left as they are.
 */

const PERMISSIONS_TX_TIMEOUT_MS = 15_000;

const SECTION_BY_SLUG = new Map<string, SectionOption>(
  ADMIN_SECTIONS.map((s) => [s.slug, { slug: s.slug, label: s.label, icon: s.icon }]),
);

function toOptions(slugs: readonly string[]): SectionOption[] {
  return slugs.flatMap((slug) => {
    const option = SECTION_BY_SLUG.get(slug);
    return option ? [option] : [];
  });
}

function isTeamAccount(user: { role: Role; mergedIntoUserId: string | null }): boolean {
  return user.role !== "USER" && user.mergedIntoUserId === null;
}

export async function getUserPermissions(userId: string): Promise<UserPermissionsView> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, mergedIntoUserId: true },
  });
  if (!user) throw userNotFound();

  const groups = isTeamAccount(user)
    ? getGrantableSections(user.role)
    : { roleSections: [], grantableSections: [], strictSections: [] };
  const managed = new Set([...groups.grantableSections, ...groups.strictSections]);

  const grants = managed.size
    ? await prisma.adminPermission.findMany({ where: { userId }, select: { section: true } })
    : [];

  return {
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    roleSections: toOptions(groups.roleSections),
    grantableSections: toOptions(groups.grantableSections),
    strictSections: toOptions(groups.strictSections),
    granted: grants.map((g) => g.section).filter((s) => managed.has(s)),
    notes: { superadminStrictAutoGrant: user.role === "SUPERADMIN" && isTeamAccount(user) },
  };
}

function notGrantable(slug: string): DomainError {
  const known = (ADMIN_SECTION_SLUGS as readonly string[]).includes(slug);
  if (known && SUPERADMIN_ONLY_SECTIONS.has(slug)) {
    const label = SECTION_BY_SLUG.get(slug)?.label ?? slug;
    return new DomainError(
      "SECTION_NOT_GRANTABLE",
      `Раздел «${label}» доступен только суперадмину`,
      422,
    );
  }
  return new DomainError("SECTION_NOT_GRANTABLE", USER_ERROR_MESSAGES.SECTION_UNKNOWN, 422);
}

/**
 * Save the modal. Role sections in the request are dropped silently (old
 * clients sent them — AC-A4.2); «Звонки» and unknown slugs → 422. Revoking
 * anything bumps the session version (ADR §Q1). One AuditLog row with
 * before → after (AC-A4.6).
 */
export async function updateUserPermissions(
  userId: string,
  sections: string[],
  actorId: string,
): Promise<UserPermissionsUpdateResult> {
  const outcome = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; role: Role; mergedIntoUserId: string | null }>>`
        SELECT "id", "role"::text AS "role", "mergedIntoUserId"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `;
      const user = rows[0];
      if (!user) throw userNotFound();
      if (!isTeamAccount(user)) {
        throw new DomainError("NOT_IN_TEAM", USER_ERROR_MESSAGES.NOT_IN_TEAM, 422);
      }

      const { roleSections, grantableSections, strictSections } = getGrantableSections(user.role);
      const roleOwned = new Set(roleSections);
      const managed = new Set([...grantableSections, ...strictSections]);

      const requested = [...new Set(sections)].filter((s) => !roleOwned.has(s));
      const invalid = requested.find((s) => !managed.has(s));
      if (invalid !== undefined) throw notGrantable(invalid);

      const explicit = await tx.adminPermission.findMany({
        where: { userId },
        select: { section: true },
      });
      const before = explicit.map((p) => p.section).filter((s) => managed.has(s));
      const after = requested;
      const added = after.filter((s) => !before.includes(s));
      const removed = before.filter((s) => !after.includes(s));

      if (removed.length > 0) {
        await tx.adminPermission.deleteMany({ where: { userId, section: { in: removed } } });
      }
      if (added.length > 0) {
        await tx.adminPermission.createMany({
          data: added.map((section) => ({ userId, section })),
          skipDuplicates: true,
        });
      }
      if (removed.length > 0) await bumpSessionVersion(tx, userId);

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "permissions.update",
          entity: "AdminPermission",
          entityId: userId,
          metadata: { targetRole: user.role, before, after, added, removed },
        },
      });

      return { after, revoked: removed.length > 0 };
    },
    { timeout: PERMISSIONS_TX_TIMEOUT_MS },
  );

  if (outcome.revoked) await publishAuthState(userId);

  return { userId, granted: outcome.after };
}
