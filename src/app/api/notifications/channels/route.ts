import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  ChannelServiceError,
  addChannel,
  listUserChannels,
} from "@/modules/notifications/dispatch/channels-service";
import { addChannelSchema } from "@/modules/notifications/dispatch/validation";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const items = await listUserChannels(session.user.id);
    // Don't leak verification hashes
    return apiResponse(
      items.map((c) => ({
        id: c.id,
        kind: c.kind,
        address: c.address,
        label: c.label,
        priority: c.priority,
        isActive: c.isActive,
        verifiedAt: c.verifiedAt,
        createdAt: c.createdAt,
      }))
    );
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const body = await request.json().catch(() => null);
    const parsed = addChannelSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const channel = await addChannel(session.user.id, parsed.data);
    return apiResponse(
      {
        id: channel.id,
        kind: channel.kind,
        address: channel.address,
        label: channel.label,
        priority: channel.priority,
        isActive: channel.isActive,
        verifiedAt: channel.verifiedAt,
      },
      undefined,
      201
    );
  } catch (err) {
    if (err instanceof ChannelServiceError) return apiError(err.code, err.message, 409);
    return apiServerError();
  }
}
