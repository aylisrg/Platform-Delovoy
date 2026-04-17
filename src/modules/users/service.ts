import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { setUserAdminSections } from "@/lib/permissions";
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

  return user;
}

export async function listUsers(search?: string) {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  return prisma.user.findMany({
    where,
    select: USER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
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

export async function updateUser(id: string, input: UpdateUserInput, currentUserId: string) {
  // Prevent demoting yourself
  if (id === currentUserId && input.role && input.role !== "SUPERADMIN") {
    throw new Error("CANNOT_DEMOTE_SELF");
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.telegramId !== undefined ? { telegramId: input.telegramId || null } : {}),
    },
    select: USER_SELECT,
  });

  // When role changes to MANAGER, ensure "dashboard" permission always exists
  if (input.role === "MANAGER" && user.role !== "MANAGER") {
    await prisma.adminPermission.upsert({
      where: { userId_section: { userId: id, section: "dashboard" } },
      create: { userId: id, section: "dashboard" },
      update: {},
    });
  }

  return updated;
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

export async function deleteUser(id: string, currentUserId: string) {
  if (id === currentUserId) {
    throw new Error("CANNOT_DELETE_SELF");
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  await prisma.user.delete({ where: { id } });
}
