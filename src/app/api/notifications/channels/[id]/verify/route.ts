import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  ChannelServiceError,
  startVerification,
} from "@/modules/notifications/dispatch/channels-service";
import { rateLimitCustom } from "@/modules/tasks/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const limited = await rateLimitCustom(
      session.user.id,
      "notif-verify-start",
      5,
      60
    );
    if (limited) return limited;

    const { id } = await params;
    const challenge = await startVerification(session.user.id, id);
    return apiResponse(challenge);
  } catch (err) {
    if (err instanceof ChannelServiceError) return apiError(err.code, err.message, 400);
    return apiServerError();
  }
}
