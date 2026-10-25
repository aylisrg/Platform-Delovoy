import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiForbidden, apiValidationError, apiServerError } from "@/lib/api-response";
import {
  listEligibleRecipients,
  setRecipientUserIds,
} from "@/modules/notifications/recipients";

const putSchema = z.object({
  userIds: z.array(z.string()).max(50),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") return apiForbidden();

  try {
    const { slug } = await params;
    const recipients = await listEligibleRecipients(slug);
    return apiResponse(recipients);
  } catch {
    return apiServerError();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "SUPERADMIN") return apiForbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiValidationError("Некорректный запрос");
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0].message);
  }

  try {
    const { slug } = await params;
    const saved = await setRecipientUserIds(slug, parsed.data.userIds, session.user.id);
    return apiResponse({ saved: true, userIds: saved });
  } catch (error) {
    if (error instanceof Error && error.message === "MODULE_NOT_FOUND") {
      return apiError("NOT_FOUND", "Модуль не найден", 404);
    }
    return apiServerError();
  }
}
