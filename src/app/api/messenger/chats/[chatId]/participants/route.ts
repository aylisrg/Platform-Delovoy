import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { canAccessChat, canAddParticipantToChat } from "@/modules/messenger/access";
import { addParticipant, getParticipants } from "@/modules/messenger/service";
import { addParticipantSchema } from "@/modules/messenger/validation";

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
  return apiResponse(participants);
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
  if (!chat) return apiNotFound();

  // Determine caller's role in this chat.
  const myParticipant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId: session.user.id } },
    select: { role: true },
  });

  if (!canAddParticipantToChat(session.user, chat, myParticipant?.role)) {
    return apiForbidden();
  }

  const parsed = addParticipantSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.message, 422);

  await addParticipant(chatId, parsed.data.userId, parsed.data.role);
  const participants = await getParticipants(chatId);
  return apiResponse(participants, undefined, 201);
}
