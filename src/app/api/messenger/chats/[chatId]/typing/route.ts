import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { canAccessChat } from "@/modules/messenger/access";
import { publishTyping } from "@/modules/messenger/service";

type Params = { params: Promise<{ chatId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  // Aggressive rate limit: 20 events/min per user (3s client throttle → max ~20).
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

  publishTyping(chatId, session.user.id, session.user.name ?? null);
  return apiResponse({ ok: true });
}
