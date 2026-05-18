import { prisma } from "@/lib/db";
import type { Chat, ChatKind, ChatMessage, Prisma } from "@prisma/client";
import { canStartDirect } from "./eligibility";
import type {
  EligibilityResult,
  ListChatsResult,
  ListMessagesResult,
  PublicChat,
  PublicMessage,
  PublicParticipant,
  SendMessageResult,
} from "./types";
import { broadcastToParticipant, broadcastToChat } from "@/lib/user-events";
import { broadcastAdminEvent } from "@/lib/admin-events";
import { isOnline } from "@/lib/realtime/presence";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";

export { canStartDirect };
export type { EligibilityResult, ListChatsResult, ListMessagesResult, PublicChat, PublicMessage, SendMessageResult };

// ── helpers ─────────────────────────────────────────────────────────────────

function toPublicMessage(
  msg: ChatMessage & {
    sender: { id: string; name: string | null; image: string | null };
    receipts: { userId: string }[];
  },
): PublicMessage {
  return {
    id: msg.id,
    chatId: msg.chatId,
    senderUserId: msg.senderUserId,
    senderName: msg.sender.name,
    senderImage: msg.sender.image,
    body: msg.deletedAt ? "" : msg.body,
    clientId: msg.clientId,
    editedAt: msg.editedAt,
    deletedAt: msg.deletedAt,
    createdAt: msg.createdAt,
    readByCount: msg.receipts.length,
  };
}

function toPublicParticipant(
  p: {
    userId: string;
    role: "MEMBER" | "ADMIN";
    joinedAt: Date;
    leftAt: Date | null;
    unreadCount: number;
    mutedUntil: Date | null;
    user: { name: string | null; image: string | null };
  },
): PublicParticipant {
  return {
    userId: p.userId,
    name: p.user.name,
    image: p.user.image,
    role: p.role,
    joinedAt: p.joinedAt,
    leftAt: p.leftAt,
    unreadCount: p.unreadCount,
    mutedUntil: p.mutedUntil,
  };
}

const participantSelect = {
  userId: true,
  role: true,
  joinedAt: true,
  leftAt: true,
  unreadCount: true,
  mutedUntil: true,
  user: { select: { name: true, image: true } },
} satisfies Prisma.ChatParticipantSelect;

const messageWithSenderSelect = {
  id: true,
  chatId: true,
  senderUserId: true,
  body: true,
  clientId: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  sender: { select: { id: true, name: true, image: true } },
  receipts: { select: { userId: true } },
} satisfies Prisma.ChatMessageSelect;

// ── health ────────────────────────────────────────────────────────────────

export async function getHealthMetrics() {
  const [chatCount, messageCount] = await Promise.all([
    prisma.chat.count(),
    prisma.chatMessage.count(),
  ]);
  return { chatCount, messageCount };
}

// ── chat creation ────────────────────────────────────────────────────────

export async function getOrCreateSupportChat(userId: string): Promise<PublicChat> {
  return _getOrCreateTopicChat(userId, "SUPPORT");
}

export async function getOrCreateTopicBookingsChat(userId: string): Promise<PublicChat> {
  return _getOrCreateTopicChat(userId, "TOPIC_BOOKINGS");
}

export async function getOrCreateTopicContractsChat(userId: string): Promise<PublicChat> {
  return _getOrCreateTopicChat(userId, "TOPIC_CONTRACTS");
}

async function _getOrCreateTopicChat(
  userId: string,
  kind: "SUPPORT" | "TOPIC_BOOKINGS" | "TOPIC_CONTRACTS",
): Promise<PublicChat> {
  // Find existing active (non-archived) chat of this kind for this user.
  const existing = await prisma.chat.findFirst({
    where: {
      kind,
      archivedAt: null,
      participants: { some: { userId, leftAt: null } },
    },
    include: {
      participants: { where: { leftAt: null }, select: participantSelect },
    },
  });

  if (existing) return _toPublicChat(existing);

  // Create new chat + participant in transaction.
  const chat = await prisma.$transaction(async (tx) => {
    const c = await tx.chat.create({
      data: {
        kind,
        createdByUserId: userId,
        participants: {
          create: { userId, role: "MEMBER" },
        },
      },
      include: {
        participants: { where: { leftAt: null }, select: participantSelect },
      },
    });
    return c;
  });

  return _toPublicChat(chat);
}

export async function getOrCreateDirectChat(
  userIdA: string,
  userIdB: string,
): Promise<{ chat: PublicChat; created: boolean }> {
  // Find existing DIRECT chat between A and B.
  const existing = await prisma.chat.findFirst({
    where: {
      kind: "DIRECT",
      archivedAt: null,
      participants: { some: { userId: userIdA, leftAt: null } },
      AND: [{ participants: { some: { userId: userIdB, leftAt: null } } }],
    },
    include: {
      participants: { where: { leftAt: null }, select: participantSelect },
    },
  });

  if (existing) return { chat: _toPublicChat(existing), created: false };

  const chat = await prisma.chat.create({
    data: {
      kind: "DIRECT",
      createdByUserId: userIdA,
      participants: {
        create: [
          { userId: userIdA, role: "MEMBER" },
          { userId: userIdB, role: "MEMBER" },
        ],
      },
    },
    include: {
      participants: { where: { leftAt: null }, select: participantSelect },
    },
  });

  return { chat: _toPublicChat(chat), created: true };
}

export async function createGroupChat(
  createdByUserId: string,
  title: string,
  participantUserIds: string[],
): Promise<PublicChat> {
  const allParticipants = [
    ...new Set([createdByUserId, ...participantUserIds]),
  ];
  const chat = await prisma.chat.create({
    data: {
      kind: "GROUP",
      title,
      createdByUserId,
      participants: {
        create: allParticipants.map((uid) => ({
          userId: uid,
          role: uid === createdByUserId ? ("ADMIN" as const) : ("MEMBER" as const),
        })),
      },
    },
    include: {
      participants: { where: { leftAt: null }, select: participantSelect },
    },
  });
  return _toPublicChat(chat);
}

// ── participant management ────────────────────────────────────────────────

export async function addParticipant(
  chatId: string,
  userId: string,
  role: "MEMBER" | "ADMIN" = "MEMBER",
): Promise<void> {
  await prisma.chatParticipant.upsert({
    where: { chatId_userId: { chatId, userId } },
    create: { chatId, userId, role },
    update: { leftAt: null, role },
  });
}

export async function removeParticipant(
  chatId: string,
  userId: string,
): Promise<void> {
  await prisma.chatParticipant.updateMany({
    where: { chatId, userId, leftAt: null },
    data: { leftAt: new Date() },
  });
}

export async function leaveChat(chatId: string, userId: string): Promise<void> {
  await removeParticipant(chatId, userId);
}

// ── listing ───────────────────────────────────────────────────────────────

export async function listChatsForUser(
  userId: string,
  opts: { search?: string; cursor?: string; kind?: ChatKind } = {},
): Promise<ListChatsResult> {
  const limit = 30;
  const where: Prisma.ChatWhereInput = {
    archivedAt: null,
    participants: { some: { userId, leftAt: null } },
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.cursor ? { lastMessageAt: { lt: new Date(opts.cursor) } } : {}),
  };

  const chats = await prisma.chat.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
    include: {
      participants: {
        where: { leftAt: null },
        select: participantSelect,
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: messageWithSenderSelect,
      },
    },
  });

  const hasMore = chats.length > limit;
  if (hasMore) chats.pop();

  const publicChats: PublicChat[] = chats.map((c) => {
    const myParticipant = c.participants.find((p) => p.userId === userId);
    return {
      ..._toPublicChat(c),
      unreadCount: myParticipant?.unreadCount ?? 0,
      lastMessage: c.messages[0] ? toPublicMessage(c.messages[0]) : null,
    };
  });

  return {
    chats: publicChats,
    nextCursor: hasMore && chats[chats.length - 1]?.lastMessageAt
      ? chats[chats.length - 1].lastMessageAt!.toISOString()
      : null,
  };
}

export async function listChatsForAdmin(opts: {
  cursor?: string;
  search?: string;
  kind?: ChatKind;
  hasUnread?: boolean;
  userId?: string;
} = {}): Promise<ListChatsResult> {
  const limit = 50;
  const where: Prisma.ChatWhereInput = {
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.userId
      ? { participants: { some: { userId: opts.userId, leftAt: null } } }
      : {}),
    ...(opts.hasUnread
      ? { participants: { some: { unreadCount: { gt: 0 } } } }
      : {}),
    ...(opts.cursor ? { lastMessageAt: { lt: new Date(opts.cursor) } } : {}),
  };

  const chats = await prisma.chat.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: limit + 1,
    include: {
      participants: {
        where: { leftAt: null },
        select: participantSelect,
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: messageWithSenderSelect,
      },
    },
  });

  const hasMore = chats.length > limit;
  if (hasMore) chats.pop();

  return {
    chats: chats.map((c) => ({
      ..._toPublicChat(c),
      unreadCount: c.participants.reduce((sum, p) => sum + p.unreadCount, 0),
      lastMessage: c.messages[0] ? toPublicMessage(c.messages[0]) : null,
    })),
    nextCursor: hasMore && chats[chats.length - 1]?.lastMessageAt
      ? chats[chats.length - 1].lastMessageAt!.toISOString()
      : null,
  };
}

// ── messages ──────────────────────────────────────────────────────────────

export async function sendMessage(opts: {
  chatId: string;
  senderUserId: string;
  body: string;
  clientId?: string;
  senderIsAdmin?: boolean;
}): Promise<SendMessageResult> {
  const { chatId, senderUserId, body, clientId, senderIsAdmin } = opts;

  // Idempotency: return existing message if clientId already used in this chat.
  if (clientId) {
    const existing = await prisma.chatMessage.findUnique({
      where: { chatId_clientId: { chatId, clientId } },
      select: messageWithSenderSelect,
    });
    if (existing) {
      const chat = await prisma.chat.findUniqueOrThrow({
        where: { id: chatId },
        select: { id: true, lastMessageAt: true },
      });
      return { message: toPublicMessage(existing), chat };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Create message.
    const msg = await tx.chatMessage.create({
      data: {
        chatId,
        senderUserId,
        body: body.trim(),
        clientId: clientId ?? null,
      },
      select: messageWithSenderSelect,
    });

    // Update chat.lastMessageAt.
    const updatedChat = await tx.chat.update({
      where: { id: chatId },
      data: { lastMessageAt: msg.createdAt },
      select: { id: true, lastMessageAt: true, kind: true },
    });

    // Bump unreadCount for all other active participants.
    await tx.chatParticipant.updateMany({
      where: {
        chatId,
        userId: { not: senderUserId },
        leftAt: null,
      },
      data: { unreadCount: { increment: 1 } },
    });

    // Auto-add admin as participant in SUPPORT/TOPIC chats on first admin reply.
    if (senderIsAdmin && (updatedChat.kind === "SUPPORT" || updatedChat.kind === "TOPIC_BOOKINGS" || updatedChat.kind === "TOPIC_CONTRACTS")) {
      await tx.chatParticipant.upsert({
        where: { chatId_userId: { chatId, userId: senderUserId } },
        create: { chatId, userId: senderUserId, role: "ADMIN" },
        update: { leftAt: null },
      });
    }

    return { message: toPublicMessage(msg), chat: { id: updatedChat.id, lastMessageAt: updatedChat.lastMessageAt } };
  });

  // Fan-out realtime events + push to offline recipients (fire-and-forget).
  _fanOut(chatId, result.message, senderUserId, senderIsAdmin).catch(() => {});

  return result;
}

export async function listMessages(
  chatId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<ListMessagesResult> {
  const limit = Math.min(opts.limit ?? 50, 100);

  const messages = await prisma.chatMessage.findMany({
    where: {
      chatId,
      ...(opts.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: messageWithSenderSelect,
  });

  const hasMore = messages.length > limit;
  if (hasMore) messages.pop();

  // Return oldest-first for UI rendering.
  messages.reverse();

  return {
    messages: messages.map(toPublicMessage),
    nextCursor: hasMore && messages[0]?.createdAt
      ? messages[0].createdAt.toISOString()
      : null,
  };
}

export async function editMessage(
  chatId: string,
  messageId: string,
  body: string,
): Promise<PublicMessage> {
  const msg = await prisma.chatMessage.update({
    where: { id: messageId, chatId },
    data: { body: body.trim(), editedAt: new Date() },
    select: messageWithSenderSelect,
  });
  return toPublicMessage(msg);
}

export async function softDeleteMessage(chatId: string, messageId: string): Promise<void> {
  await prisma.chatMessage.update({
    where: { id: messageId, chatId },
    data: { deletedAt: new Date() },
  });
}

// ── read receipts ─────────────────────────────────────────────────────────

export async function markRead(
  chatId: string,
  userId: string,
  upToMessageId: string,
): Promise<void> {
  // Find the target message's createdAt to batch-receipt all messages up to it.
  const upTo = await prisma.chatMessage.findUnique({
    where: { id: upToMessageId },
    select: { createdAt: true },
  });
  if (!upTo) return;

  // Find messages sent by others that haven't been receipted yet.
  const unread = await prisma.chatMessage.findMany({
    where: {
      chatId,
      senderUserId: { not: userId },
      createdAt: { lte: upTo.createdAt },
      deletedAt: null,
      receipts: { none: { userId } },
    },
    select: { id: true },
  });

  if (unread.length > 0) {
    await prisma.chatMessageReceipt.createMany({
      data: unread.map((m) => ({ messageId: m.id, userId })),
      skipDuplicates: true,
    });
  }

  // Reset unread counter and update lastReadMessageId.
  await prisma.chatParticipant.updateMany({
    where: { chatId, userId },
    data: { unreadCount: 0, lastReadMessageId: upToMessageId },
  });
}

// ── participant list ───────────────────────────────────────────────────────

export async function getParticipants(chatId: string): Promise<PublicParticipant[]> {
  const participants = await prisma.chatParticipant.findMany({
    where: { chatId, leftAt: null },
    select: participantSelect,
  });
  return participants.map(toPublicParticipant);
}

// ── user search ────────────────────────────────────────────────────────────

export async function searchUsers(
  q: string,
  limit: number,
  forUserId: string,
  isAdmin: boolean,
): Promise<{ id: string; name: string | null; image: string | null }[]> {
  const users = await prisma.user.findMany({
    where: {
      id: { not: forUserId },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(isAdmin ? [{ phone: { contains: q, mode: "insensitive" as const } }] : []),
      ],
    },
    take: isAdmin ? limit : limit * 3,
    select: { id: true, name: true, image: true },
  });

  // For non-admin: filter to only eligible users.
  if (!isAdmin) {
    const eligible: typeof users = [];
    for (const u of users) {
      const result = await canStartDirect(forUserId, u.id);
      if (result.ok) eligible.push(u);
      if (eligible.length >= limit) break;
    }
    return eligible;
  }

  return users.slice(0, limit);
}

// ── internal helpers ───────────────────────────────────────────────────────

// ── realtime fan-out + push ───────────────────────────────────────────────

async function _fanOut(
  chatId: string,
  message: PublicMessage,
  senderUserId: string,
  senderIsAdmin?: boolean,
): Promise<void> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      participants: {
        where: { leftAt: null },
        select: { userId: true, role: true, mutedUntil: true },
      },
    },
  });
  if (!chat) return;

  const recipients = chat.participants.filter((p) => p.userId !== senderUserId);
  const realtimeEvent = {
    type: "message.created",
    chatId,
    message,
  };

  // Broadcast via SSE / admin events + conditionally push.
  for (const recipient of recipients) {
    broadcastToParticipant(recipient.userId, realtimeEvent);

    // Notify admin channel so /admin/messenger SSE clients see the new message.
    if (!senderIsAdmin) {
      broadcastAdminEvent({
        id: message.id,
        type: "messenger.message.created",
        moduleSlug: "messenger",
        entityId: chatId,
        title: `Сообщение от ${message.senderName ?? "пользователя"}`,
        body: message.deletedAt ? "(сообщение удалено)" : message.body.slice(0, 120),
        timestamp: message.createdAt.toISOString(),
      });
    }

    // Push to offline recipients (skip if muted).
    const isMuted = recipient.mutedUntil && recipient.mutedUntil > new Date();
    const online = await isOnline(recipient.userId);
    if (!online && !isMuted) {
      const isAdminRecipient = recipient.role === "ADMIN";
      const url = isAdminRecipient
        ? `/admin/messenger/${chatId}`
        : `/webapp/messenger/${chatId}`;

      await dispatch({
        userId: recipient.userId,
        eventType: "messenger.message.received",
        entityType: "chat",
        entityId: chatId,
        payload: {
          title: message.senderName ?? "Новое сообщение",
          body: message.deletedAt ? "(сообщение удалено)" : message.body.slice(0, 200),
          actions: [{ label: "Открыть", url }],
          metadata: { url, tag: `chat-${chatId}`, icon: "/icons/webapp-192.png" },
        },
      }).catch(() => {});
    }
  }
}

// ── chat-level realtime (typing, read) ───────────────────────────────────

export function publishTyping(chatId: string, userId: string, userName: string | null): void {
  broadcastToChat(chatId, { type: "typing", chatId, userId, userName });
}

export function publishRead(chatId: string, userId: string, upToMessageId: string): void {
  broadcastToChat(chatId, { type: "read", chatId, userId, upToMessageId });
}

function _toPublicChat(
  chat: Chat & {
    participants: {
      userId: string;
      role: "MEMBER" | "ADMIN";
      joinedAt: Date;
      leftAt: Date | null;
      unreadCount: number;
      mutedUntil: Date | null;
      user: { name: string | null; image: string | null };
    }[];
  },
  lastMessage?: PublicMessage | null,
): PublicChat {
  return {
    id: chat.id,
    kind: chat.kind,
    title: chat.title,
    createdByUserId: chat.createdByUserId,
    lastMessageAt: chat.lastMessageAt,
    archivedAt: chat.archivedAt,
    createdAt: chat.createdAt,
    unreadCount: 0,
    participants: chat.participants.map(toPublicParticipant),
    lastMessage: lastMessage ?? null,
  };
}
