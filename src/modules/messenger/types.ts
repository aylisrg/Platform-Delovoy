import type {
  Chat,
  ChatKind,
  ChatMessage,
  ChatParticipant,
  ChatParticipantRole,
  User,
} from "@prisma/client";

export type { ChatKind, ChatParticipantRole };

export type PublicMessage = {
  id: string;
  chatId: string;
  senderUserId: string;
  senderName: string | null;
  senderImage: string | null;
  body: string;
  clientId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  readByCount: number;
};

export type PublicParticipant = {
  userId: string;
  name: string | null;
  image: string | null;
  role: ChatParticipantRole;
  joinedAt: Date;
  leftAt: Date | null;
  unreadCount: number;
  mutedUntil: Date | null;
};

export type PublicChat = {
  id: string;
  kind: ChatKind;
  title: string | null;
  createdByUserId: string;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  unreadCount: number;
  participants: PublicParticipant[];
  lastMessage: PublicMessage | null;
};

export type SendMessageResult = {
  message: PublicMessage;
  chat: { id: string; lastMessageAt: Date | null };
};

export type ListMessagesResult = {
  messages: PublicMessage[];
  nextCursor: string | null;
};

export type ListChatsResult = {
  chats: PublicChat[];
  nextCursor: string | null;
};

export type EligibilityResult =
  | { ok: true; reason: "rental_co_tenant" | "shared_office" | "admin_created" }
  | { ok: false; reason: "no_shared_connection" };
