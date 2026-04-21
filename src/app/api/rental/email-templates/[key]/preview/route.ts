import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  apiNotFound,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { previewTemplateSchema } from "@/modules/rental/validation";
import { renderWithMissing } from "@/modules/rental/template-engine";
import { sanitizeEmailHtml } from "@/modules/rental/sanitize";
import { rateLimit } from "@/lib/rate-limit";

const DEMO_VARS: Record<string, string> = {
  tenantName: "ООО «Пример»",
  contactName: "Иванов И. И.",
  contractNumber: "А-2026-001",
  officeNumber: "301",
  building: "2",
  floor: "3",
  amount: "45 000,00 ₽",
  currency: "RUB",
  dueDate: "01.05.2026",
  periodMonth: "май",
  periodYear: "2026",
  daysOverdue: "0",
  bankDetails: "Р/с 40702810100000012345, БИК 044525999\nООО «Деловой Парк», ИНН 5030012345",
  managerName: "Петров Пётр",
  managerPhone: "+7 (495) 123-45-67",
  parkAddress: "Селятино, Московская область, Бизнес-парк «Деловой»",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const { key } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = previewTemplateSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const tpl = await prisma.emailTemplate.findUnique({ where: { key } });
    if (!tpl) return apiNotFound("Шаблон не найден");

    const vars = { ...DEMO_VARS, ...(parsed.data.sampleVars ?? {}) };
    const rendered = renderWithMissing(tpl, vars);
    return apiResponse({
      subject: rendered.subject,
      html: sanitizeEmailHtml(rendered.html),
      text: rendered.text,
      missingVars: rendered.missingVars,
    });
  } catch {
    return apiServerError();
  }
}
