import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiError, apiResponse, apiServerError, apiUnauthorized } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { canStartDirect, createGroupChat, getOrCreateDirectChat, getOrCreateSupportChat, getOrCreateTopicBookingsChat, getOrCreateTopicContractsChat, listChatsForUser } from "@/modules/messenger/service";
import { canCreateGroup } from "@/modules/messenger/access";
import { createChatSchema, listChatsQuerySchema } from "@/modules/messenger/validation";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const query = listChatsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) return apiError("VALIDATION_ERROR", query.error.message, 422);

  try {
    const result = await listChatsForUser(session.user.id, query.data);
    return apiResponse(result.chats, { limit: 30 });
  } catch (err) {
    console.error("[messenger/chats GET]", err);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const body = createChatSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return apiError("VALIDATION_ERROR", body.error.message, 422);

  const data = body.data;

  if (data.kind === "SUPPORT") {
    const chat = await getOrCreateSupportChat(session.user.id);
    return apiResponse(chat, undefined, 201);
  }

  if (data.kind === "TOPIC_BOOKINGS") {
    const chat = await getOrCreateTopicBookingsChat(session.user.id);
    return apiResponse(chat, undefined, 201);
  }

  if (data.kind === "TOPIC_CONTRACTS") {
    const chat = await getOrCreateTopicContractsChat(session.user.id);
    return apiResponse(chat, undefined, 201);
  }

  if (data.kind === "DIRECT") {
    const eligibility = await canStartDirect(session.user.id, data.otherUserId);
    if (!eligibility.ok) {
      return apiError("FORBIDDEN", "Нет общих связей с этим пользователем", 403);
    }
    const { chat, created } = await getOrCreateDirectChat(session.user.id, data.otherUserId);
    return apiResponse(chat, undefined, created ? 201 : 200);
  }

  if (data.kind === "GROUP") {
    if (!canCreateGroup(session.user)) {
      return apiError("FORBIDDEN", "Только администраторы могут создавать групповые чаты", 403);
    }
    const chat = await createGroupChat(session.user.id, data.title, data.participantUserIds);
    return apiResponse(chat, undefined, 201);
  }

  return apiError("VALIDATION_ERROR", "Неизвестный тип чата", 422);
}
