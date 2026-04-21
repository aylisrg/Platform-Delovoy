import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { createEmailTemplateSchema } from "@/modules/rental/validation";
import { requireAdminSection } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const includeInactive =
      request.nextUrl.searchParams.get("includeInactive") === "true";

    const templates = await prisma.emailTemplate.findMany({
      where: {
        moduleSlug: "rental",
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return apiResponse(templates);
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const body = await request.json();
    const parsed = createEmailTemplateSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const exists = await prisma.emailTemplate.findUnique({
      where: { key: parsed.data.key },
    });
    if (exists) {
      return apiError("TEMPLATE_EXISTS", "Шаблон с таким ключом уже существует", 409);
    }

    const tpl = await prisma.emailTemplate.create({
      data: {
        key: parsed.data.key,
        name: parsed.data.name,
        subject: parsed.data.subject,
        bodyHtml: parsed.data.bodyHtml,
        bodyText: parsed.data.bodyText ?? null,
        variables: parsed.data.variables,
        isActive: parsed.data.isActive,
        isSystem: false,
      },
    });

    await logAudit(session.user.id, "email_template.created", "EmailTemplate", tpl.id, {
      key: tpl.key,
    });
    return apiResponse(tpl, undefined, 201);
  } catch {
    return apiServerError();
  }
}
