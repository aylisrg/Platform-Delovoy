import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { canDeleteMessage, canEditMessage } from "@/modules/messenger/access";
import { editMessage, softDeleteMessage } from "@/modules/messenger/service";
import { editMessageSchema } from "@/modules/messenger/validation";

type Params = { params: Promise<{ chatId: string; messageId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId, messageId } = await params;
  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId, chatId },
    select: { id: true, senderUserId: true, createdAt: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) return apiNotFound();

  if (!canEditMessage(session.user, msg)) {
    return apiForbidden("Редактирование недоступно (только автор в течение 15 минут)");
  }

  const parsed = editMessageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.message, 422);

  const updated = await editMessage(chatId, messageId, parsed.data.body);
  return apiResponse(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId, messageId } = await params;
  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId, chatId },
    select: { id: true, senderUserId: true, deletedAt: true },
  });
  if (!msg || msg.deletedAt) return apiNotFound();

  if (!canDeleteMessage(session.user, msg)) return apiForbidden();

  await softDeleteMessage(chatId, messageId);
  return apiResponse({ deleted: true });
}
