import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiForbidden, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { canAccessChat } from "@/modules/messenger/access";
import { getParticipants } from "@/modules/messenger/service";

type Params = { params: Promise<{ chatId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
  if (!chat) return apiNotFound();

  const allowed = await canAccessChat(session.user, chat);
  if (!allowed) return apiForbidden();

  const participants = await getParticipants(chatId);
  return apiResponse({ ...chat, participants });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
  if (!chat) return apiNotFound();

  const allowed = await canAccessChat(session.user, chat);
  if (!allowed) return apiForbidden();

  const body = await request.json().catch(() => ({})) as { archived?: boolean };
  if (typeof body.archived !== "boolean") {
    return apiError("VALIDATION_ERROR", "archived must be boolean", 422);
  }

  const updated = await prisma.chat.update({
    where: { id: chatId },
    data: { archivedAt: body.archived ? new Date() : null },
  });
  return apiResponse(updated);
}
