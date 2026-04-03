import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { updateModuleConfig, ArchitectError } from "@/modules/monitoring/architect-service";
import { updateModuleConfigSchema } from "@/modules/monitoring/architect-validation";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  try {
    const mod = await prisma.module.findUnique({ where: { id } });
    if (!mod) return apiNotFound("Модуль не найден");
    return apiResponse(mod);
  } catch {
    return apiServerError();
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }

  const parsed = updateModuleConfigSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? "Ошибка валидации");
  }

  try {
    const updated = await updateModuleConfig(id, parsed.data, session.user.id);
    return apiResponse(updated);
  } catch (err) {
    if (err instanceof ArchitectError && err.code === "MODULE_NOT_FOUND") {
      return apiNotFound(err.message);
    }
    return apiServerError();
  }
}
