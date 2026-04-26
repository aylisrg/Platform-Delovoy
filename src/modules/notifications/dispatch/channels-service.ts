import { randomInt, createHash } from "crypto";
import type { NotificationChannelKind, UserNotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ChannelRegistry } from "./channel-registry";
import { bootstrapChannels } from "./channels";

bootstrapChannels();

export class ChannelServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ChannelServiceError";
  }
}

const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

export async function listUserChannels(userId: string): Promise<UserNotificationChannel[]> {
  return prisma.userNotificationChannel.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
  });
}

export async function addChannel(
  userId: string,
  data: {
    kind: NotificationChannelKind;
    address: string;
    label?: string;
    priority?: number;
  }
): Promise<UserNotificationChannel> {
  const existing = await prisma.userNotificationChannel.findUnique({
    where: {
      userId_kind_address: {
        userId,
        kind: data.kind,
        address: data.address,
      },
    },
  });
  if (existing) {
    throw new ChannelServiceError("CHANNEL_EXISTS", "Этот канал уже добавлен");
  }
  return prisma.userNotificationChannel.create({
    data: {
      userId,
      kind: data.kind,
      address: data.address,
      label: data.label,
      priority: data.priority ?? 100,
      isActive: true,
    },
  });
}

export async function removeChannel(userId: string, channelId: string): Promise<void> {
  const channel = await prisma.userNotificationChannel.findUnique({
    where: { id: channelId },
  });
  if (!channel || channel.userId !== userId) {
    throw new ChannelServiceError("NOT_FOUND", "Канал не найден");
  }
  await prisma.userNotificationChannel.delete({ where: { id: channelId } });
}

export async function startVerification(
  userId: string,
  channelId: string
): Promise<{ method: "code"; hint: string; expiresAt: Date }> {
  const channel = await prisma.userNotificationChannel.findUnique({
    where: { id: channelId },
  });
  if (!channel || channel.userId !== userId) {
    throw new ChannelServiceError("NOT_FOUND", "Канал не найден");
  }
  const impl = ChannelRegistry.get(channel.kind);
  if (!impl?.isAvailable()) {
    throw new ChannelServiceError(
      "CHANNEL_UNAVAILABLE",
      `Канал ${channel.kind} не настроен`
    );
  }
  const code = String(randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL_MS);
  await prisma.userNotificationChannel.update({
    where: { id: channel.id },
    data: {
      verificationCodeHash: codeHash,
      verificationExpiresAt: expiresAt,
      verificationAttempts: 0,
    },
  });

  await impl.send(channel.address, {
    title: "Подтверждение канала",
    body: `Код подтверждения: ${code}\n\nДействует 10 минут. Если не запрашивали — проигнорируйте.`,
  });

  return {
    method: "code",
    hint: `Код выслан на ${maskAddress(channel.kind, channel.address)}`,
    expiresAt,
  };
}

export async function confirmVerification(
  userId: string,
  channelId: string,
  code: string
): Promise<boolean> {
  const channel = await prisma.userNotificationChannel.findUnique({
    where: { id: channelId },
  });
  if (!channel || channel.userId !== userId) {
    throw new ChannelServiceError("NOT_FOUND", "Канал не найден");
  }
  if (!channel.verificationCodeHash || !channel.verificationExpiresAt) {
    throw new ChannelServiceError("NOT_REQUESTED", "Запросите код заново");
  }
  if (channel.verificationExpiresAt < new Date()) {
    await prisma.userNotificationChannel.update({
      where: { id: channelId },
      data: {
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0,
      },
    });
    throw new ChannelServiceError("EXPIRED", "Код истёк, запросите новый");
  }
  if (channel.verificationAttempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.userNotificationChannel.update({
      where: { id: channelId },
      data: {
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0,
      },
    });
    throw new ChannelServiceError("TOO_MANY_ATTEMPTS", "Слишком много попыток");
  }

  const ok = hashCode(code) === channel.verificationCodeHash;
  if (!ok) {
    await prisma.userNotificationChannel.update({
      where: { id: channelId },
      data: { verificationAttempts: { increment: 1 } },
    });
    return false;
  }

  await prisma.userNotificationChannel.update({
    where: { id: channelId },
    data: {
      verifiedAt: new Date(),
      verificationCodeHash: null,
      verificationExpiresAt: null,
      verificationAttempts: 0,
    },
  });
  return true;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function maskAddress(kind: NotificationChannelKind, address: string): string {
  if (kind === "EMAIL") {
    const [name, domain] = address.split("@");
    if (!domain) return address;
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (address.length <= 4) return "***";
  return `***${address.slice(-4)}`;
}
