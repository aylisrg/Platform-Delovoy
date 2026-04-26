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
  removeChannel,
} from "@/modules/notifications/dispatch/channels-service";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { id } = await params;
    await removeChannel(session.user.id, id);
    return apiResponse({ ok: true });
  } catch (err) {
    if (err instanceof ChannelServiceError) return apiError(err.code, err.message, 404);
    return apiServerError();
  }
}
