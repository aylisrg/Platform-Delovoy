import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { listEvents } from "@/modules/tasks/events-service";
import {
  TaskAccessError,
  TaskNotFoundError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const items = await listEvents(publicId, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(items);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}
