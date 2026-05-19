import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiForbidden, apiError, apiNotFound, apiResponse, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { canAccessChat } from "@/modules/messenger/access";
import { listMessages, sendMessage } from "@/modules/messenger/service";
import { listMessagesQuerySchema, sendMessageSchema } from "@/modules/messenger/validation";

type Params = { params: Promise<{ chatId: string }> };

async function resolveChat(chatId: string) {
  return prisma.chat.findUnique({
    where: { id: chatId },
    include: { participants: { select: { userId: true, leftAt: true } } },
  });
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const { chatId } = await params;
  const chat = await resolveChat(chatId);
  if (!chat) return apiNotFound();

  const allowed = await canAccessChat(session.user, chat);
  if (!allowed) return apiForbidden();

  const query = listMessagesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return apiError("VALIDATION_ERROR", query.error.message, 422);

  const result = await listMessages(chatId, query.data);
  return apiResponse(result.messages, { limit: query.data.limit });
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  // 30 msg/min for USER, 120 for ADMIN/MANAGER/SUPERADMIN.
  const isAdmin = session.user.role !== "USER";
  const limited = await rateLimit(request, isAdmin ? "authenticated" : "authenticated", session.user.id);
  if (limited) return limited;

  const { chatId } = await params;
  const chat = await resolveChat(chatId);
  if (!chat) return apiNotFound();

  const allowed = await canAccessChat(session.user, chat);
  if (!allowed) return apiForbidden();

  const clientId = request.headers.get("Idempotency-Key") ?? undefined;

  const parsed = sendMessageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.message, 422);

  const result = await sendMessage({
    chatId,
    senderUserId: session.user.id,
    body: parsed.data.body,
    clientId: parsed.data.clientId ?? clientId,
    senderIsAdmin: isAdmin,
  });

  return apiResponse(result, undefined, 201);
}
