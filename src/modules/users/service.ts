import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { CreateUserInput } from "./validation";

const SALT_ROUNDS = 10;

export async function createUser(input: CreateUserInput) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    throw new Error("USER_EXISTS");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      role: input.role,
      phone: input.phone || null,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      createdAt: true,
    },
  });

  return user;
}

export async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
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
