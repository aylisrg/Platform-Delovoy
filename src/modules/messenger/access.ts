import type { Chat, ChatParticipant } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";
import { hasModuleAccess } from "@/lib/permissions";

// MANAGER sees these TOPIC-chats only if they have access to the related module.
const TOPIC_MODULE_MAP: Record<string, string[]> = {
  TOPIC_BOOKINGS: ["gazebos", "ps-park", "booking"],
  TOPIC_CONTRACTS: ["rental", "nedelovoy", "clients"],
  SUPPORT: ["tasks", "cafe"],
};

export function isAdminRole(role: string): boolean {
  return role === "SUPERADMIN" || role === "ADMIN";
}

export async function canAccessChat(
  session: SessionUser,
  chat: Chat & { participants: Pick<ChatParticipant, "userId" | "leftAt">[] },
): Promise<boolean> {
  if (session.role === "SUPERADMIN") return true;

  // Active participant always has access.
  const participant = chat.participants.find(
    (p) => p.userId === session.id && p.leftAt === null,
  );
  if (participant) return true;

  // ADMIN/MANAGER can access SUPPORT and TOPIC chats for their modules.
  if (session.role === "ADMIN" || session.role === "MANAGER") {
    const moduleList = TOPIC_MODULE_MAP[chat.kind];
    if (!moduleList) return false;
    for (const slug of moduleList) {
      if (await hasModuleAccess(session.id, slug)) return true;
    }
  }

  return false;
}

export function canCreateGroup(session: SessionUser): boolean {
  return isAdminRole(session.role);
}

export function canAddParticipantToChat(
  session: SessionUser,
  chat: Chat,
  chatParticipantRole?: string,
): boolean {
  if (chat.kind === "DIRECT") return false;
  if (chat.kind === "SUPPORT" || chat.kind === "TOPIC_BOOKINGS" || chat.kind === "TOPIC_CONTRACTS") {
    // Only auto-add allowed; no manual participant management.
    return isAdminRole(session.role);
  }
  // GROUP: creator or group ADMIN (chatParticipantRole).
  if (chat.kind === "GROUP") {
    if (isAdminRole(session.role)) return true;
    if (chatParticipantRole === "ADMIN") return true;
  }
  return false;
}

export function canEditMessage(
  session: SessionUser,
  message: { senderUserId: string; createdAt: Date },
): boolean {
  if (message.senderUserId !== session.id) return false;
  const ageMs = Date.now() - message.createdAt.getTime();
  return ageMs < 15 * 60 * 1000; // 15 minutes
}

export function canDeleteMessage(
  session: SessionUser,
  message: { senderUserId: string },
): boolean {
  if (message.senderUserId === session.id) return true;
  return isAdminRole(session.role);
}
