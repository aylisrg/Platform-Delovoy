import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { canAccessChat } from "@/modules/messenger/access";
import { markRead, publishRead } from "@/modules/messenger/service";
import { markReadSchema } from "@/modules/messenger/validation";

type Params = { params: Promise<{ chatId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const { chatId } = await params;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
  if (!chat) return apiNotFound();

  const allowed = await canAccessChat(session.user, chat);
  if (!allowed) return apiForbidden();

  const parsed = markReadSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.message, 422);

  await markRead(chatId, session.user.id, parsed.data.upToMessageId);
  publishRead(chatId, session.user.id, parsed.data.upToMessageId);
  return apiResponse({ ok: true });
}
