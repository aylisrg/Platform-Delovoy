import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
  apiNotFound,
  apiError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
  isSystemTemplateKey,
  updateEmailTemplateSchema,
} from "@/modules/rental/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const { key } = await params;
    const tpl = await prisma.emailTemplate.findUnique({ where: { key } });
    if (!tpl) return apiNotFound("Шаблон не найден");
    return apiResponse(tpl);
  } catch {
    return apiServerError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const { key } = await params;
    const body = await request.json();
    const parsed = updateEmailTemplateSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const existing = await prisma.emailTemplate.findUnique({ where: { key } });
    if (!existing) return apiNotFound("Шаблон не найден");

    const updated = await prisma.emailTemplate.update({
      where: { key },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.subject !== undefined && { subject: parsed.data.subject }),
        ...(parsed.data.bodyHtml !== undefined && { bodyHtml: parsed.data.bodyHtml }),
        ...(parsed.data.bodyText !== undefined && { bodyText: parsed.data.bodyText }),
        ...(parsed.data.variables !== undefined && { variables: parsed.data.variables }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      },
    });

    await logAudit(session.user.id, "email_template.updated", "EmailTemplate", updated.id, {
      key,
      before: { subject: existing.subject, isActive: existing.isActive },
      after: { subject: updated.subject, isActive: updated.isActive },
    });
    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { key } = await params;
    if (isSystemTemplateKey(key)) {
      return apiError(
        "SYSTEM_TEMPLATE_PROTECTED",
        "Системный шаблон нельзя удалить",
        403
      );
    }
    const tpl = await prisma.emailTemplate.findUnique({ where: { key } });
    if (!tpl) return apiNotFound("Шаблон не найден");
    if (tpl.isSystem) {
      return apiError(
        "SYSTEM_TEMPLATE_PROTECTED",
        "Системный шаблон нельзя удалить",
        403
      );
    }

    await prisma.emailTemplate.delete({ where: { key } });
    await logAudit(session.user.id, "email_template.deleted", "EmailTemplate", tpl.id, {
      key,
    });
    return apiResponse({ deleted: true });
  } catch {
    return apiServerError();
  }
}
