import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { setUserAdminSections } from "@/lib/permissions";
import { publishAuthState } from "@/lib/session-revocation";
import { ensureManagerNotifyDefaults } from "@/modules/notifications/release-notify";
import { getDeletionBlockers, UNKNOWN_BLOCKER } from "./deletion-blockers";
import { DomainError, USER_ERROR_MESSAGES, userNotFound } from "./errors";
import { changeUserRole } from "./exclusion";
import { TEAM_ROLES, type DeletionBlocker, type ExclusionResult } from "./types";
import type { CreateUserInput, UpdateUserInput } from "./validation";

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  image: true,
  telegramId: true,
  createdAt: true,
  notificationPreference: {
    select: { notifyReleases: true },
  },
} as const;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** PATCH response: the user + what was removed when the change excluded them. */
export type UpdatedUser = SelectedUser & { exclusion?: ExclusionResult };

export async function createUser(input: CreateUserInput) {
  const normalizedEmail = input.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    throw new Error("USER_EXISTS");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: input.name,
      role: input.role,
      phone: input.phone || null,
      passwordHash,
    },
    select: USER_SELECT,
  });

  // Auto-assign "dashboard" permission for new managers so they can access admin panel
  if (input.role === "MANAGER") {
    await setUserAdminSections(user.id, ["dashboard"]);
  }

  // Subscribe new admins/managers to release notifications by default.
  if (input.role === "MANAGER" || input.role === "SUPERADMIN") {
    await ensureManagerNotifyDefaults(user.id);
  }

  return user;
}

export async function listUsers(options?: {
  search?: string;
  role?: "team";
  limit?: number;
  offset?: number;
}) {
  const { search, role, limit = 50, offset = 0 } = options ?? {};

  const conditions: Record<string, unknown>[] = [];

  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search, mode: "insensitive" as const } },
        { telegramId: { contains: search, mode: "insensitive" as const } },
      ],
    });
  }

  if (role === "team") {
    conditions.push({ role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } });
  }

  const where = conditions.length > 0 ? { AND: conditions } : undefined;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        ...USER_SELECT,
        accounts: { select: { provider: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.user.count({ where }),
  ]);

  const mapped = users.map((u) => {
    const providers: string[] = [];
    if (u.telegramId) providers.push("telegram");
    if (u.email) providers.push("credentials");
    for (const acc of u.accounts) {
      if (!providers.includes(acc.provider)) providers.push(acc.provider);
    }
    const { accounts: _accounts, ...rest } = u;
    return { ...rest, authProviders: providers };
  });

  return { users: mapped, total };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  return user;
}

/**
 * Update a user. Role changes are delegated to `changeUserRole` (exclusion on
 * → USER, session revocation on demotion, defaults on promotion — US-A2);
 * name / phone / telegramId are plain field updates.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  currentUserId: string,
): Promise<UpdatedUser> {
  const { role, confirmSeeded, ...fields } = input;

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!user) throw userNotFound();

  let exclusion: ExclusionResult | undefined;
  if (role !== undefined && role !== user.role) {
    const change = await changeUserRole(id, role, currentUserId, { confirmSeeded });
    if (change.kind === "excluded") exclusion = change.exclusion;
  }

  const data = {
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.phone !== undefined ? { phone: fields.phone || null } : {}),
    ...(fields.telegramId !== undefined ? { telegramId: fields.telegramId || null } : {}),
  };

  const updated =
    Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id }, data, select: USER_SELECT })
      : await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!updated) throw userNotFound();

  return exclusion ? { ...updated, exclusion } : updated;
}

export async function resetUserPassword(id: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });
}

/**
 * Hard-delete an account without history (AC-A3.5). Anything that references
 * the user through a RESTRICT relation is reported as `USER_HAS_HISTORY` with
 * the per-type counts (AC-A3.1) instead of a database error.
 */
export async function deleteUser(id: string, currentUserId: string): Promise<void> {
  if (id === currentUserId) {
    throw new DomainError("CANNOT_DELETE_SELF", USER_ERROR_MESSAGES.CANNOT_DELETE_SELF, 400);
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, mergedIntoUserId: true },
  });
  if (!user) throw userNotFound();

  const isTeamMember = TEAM_ROLES.has(user.role) && user.mergedIntoUserId === null;

  const blockers = await getDeletionBlockers(id);
  if (blockers.length > 0) throw userHasHistory(blockers, isTeamMember);

  try {
    await prisma.$transaction([
      prisma.user.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          userId: currentUserId,
          action: "user.delete",
          entity: "User",
          entityId: id,
          metadata: { role: user.role },
        },
      }),
    ]);
  } catch (error) {
    // Race: a RESTRICT row appeared between the check and the delete, or a
    // relation the registry does not know yet. Never a 500 on an FK violation.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2003"
    ) {
      const recomputed = await getDeletionBlockers(id);
      throw userHasHistory(recomputed.length > 0 ? recomputed : [UNKNOWN_BLOCKER], isTeamMember);
    }
    throw error;
  }

  // The account is gone: drop the cached auth state so its sessions end now.
  await publishAuthState(id);
}

function userHasHistory(blockers: DeletionBlocker[], isTeamMember: boolean): DomainError {
  return new DomainError(
    "USER_HAS_HISTORY",
    isTeamMember
      ? USER_ERROR_MESSAGES.USER_HAS_HISTORY_TEAM
      : USER_ERROR_MESSAGES.USER_HAS_HISTORY_CLIENT,
    409,
    { blockers, isTeamMember },
  );
}
