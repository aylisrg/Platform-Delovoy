import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { canAddParticipantToChat } from "@/modules/messenger/access";
import { leaveChat, removeParticipant } from "@/modules/messenger/service";

type Params = { params: Promise<{ chatId: string; userId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId, userId } = await params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
  if (!chat) return apiNotFound();

  const isSelf = userId === session.user.id;

  if (isSelf) {
    // Any participant can leave a GROUP. Cannot leave SUPPORT/TOPIC/DIRECT (just archive).
    if (chat.kind !== "GROUP") {
      return apiForbidden("Используйте архивирование для этого типа чата");
    }
    await leaveChat(chatId, userId);
    return apiResponse({ left: true });
  }

  // Kicking another user — requires admin/group-admin permission.
  const myParticipant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId: session.user.id } },
    select: { role: true },
  });
  if (!canAddParticipantToChat(session.user, chat, myParticipant?.role)) {
    return apiForbidden();
  }

  await removeParticipant(chatId, userId);
  return apiResponse({ removed: true });
}
