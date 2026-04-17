import { auth } from "@/lib/auth";
import { apiResponse, apiError } from "@/lib/api-response";
import { detachChannel } from "@/modules/profile/service";
import { detachChannelSchema } from "@/modules/profile/validation";

/**
 * DELETE /api/profile/contacts/:channel/detach
 * Detach a linked auth channel from the current user's profile.
 * Blocks if it's the user's last auth method.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ channel: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError("UNAUTHORIZED", "Необходимо войти в аккаунт", 401);
  }

  const { channel } = await params;
  const parsed = detachChannelSchema.safeParse({ channel });
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Неподдерживаемый канал", 400);
  }

  try {
    const result = await detachChannel(session.user.id, parsed.data.channel);
    return apiResponse(result);
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    if (error.code === "LAST_AUTH_METHOD") {
      return apiError("LAST_AUTH_METHOD", error.message, 400);
    }
    if (error.code === "NOT_ATTACHED") {
      return apiError("NOT_ATTACHED", error.message, 400);
    }
    return apiError("SERVER_ERROR", "Ошибка сервера", 500);
  }
}
