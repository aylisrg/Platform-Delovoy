import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { bulkSendEmailSchema } from "@/modules/rental/validation";
import { sendManualEmail, RentalEmailError } from "@/modules/rental/notifications";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const rl = await rateLimit(request, "authenticated");
    if (rl) return rl;

    const userId = session!.user.id;
    const body = await request.json();
    const parsed = bulkSendEmailSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const tenants = await prisma.tenant.findMany({
      where: { id: { in: parsed.data.tenantIds }, isDeleted: false },
      select: { id: true, email: true, emailsExtra: true },
    });

    const summary = {
      sent: [] as { tenantId: string; to: string; logId: string }[],
      failed: [] as { tenantId: string; to: string; error: string }[],
      skipped: [] as { tenantId: string; reason: string }[],
    };

    for (const tenant of tenants) {
      const extra = Array.isArray(tenant.emailsExtra)
        ? (tenant.emailsExtra as unknown[]).filter(
            (v): v is string => typeof v === "string" && v.length > 0
          )
        : [];
      const all = [tenant.email, ...extra].filter(
        (v): v is string => typeof v === "string" && v.length > 0
      );
      if (all.length === 0) {
        summary.skipped.push({ tenantId: tenant.id, reason: "NO_RECIPIENT" });
        continue;
      }
      try {
        const res = await sendManualEmail({
          tenantId: tenant.id,
          to: all,
          templateKey: parsed.data.templateKey,
          customSubject: parsed.data.customSubject,
          customBodyHtml: parsed.data.customBodyHtml,
          variables: parsed.data.variables,
          sentById: userId,
        });
        for (const s of res.sent) summary.sent.push({ tenantId: tenant.id, ...s });
        for (const f of res.failed)
          summary.failed.push({ tenantId: tenant.id, to: f.to, error: f.error });
      } catch (err) {
        if (err instanceof RentalEmailError) {
          summary.skipped.push({ tenantId: tenant.id, reason: err.code });
        } else {
          summary.failed.push({
            tenantId: tenant.id,
            to: "-",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await logAudit(userId, "email.bulk_sent", "Tenant", undefined, {
      tenantIds: parsed.data.tenantIds,
      templateKey: parsed.data.templateKey,
      sent: summary.sent.length,
      failed: summary.failed.length,
      skipped: summary.skipped.length,
    });

    return apiResponse(summary);
  } catch (err) {
    if (err instanceof RentalEmailError) {
      return apiError(err.code, err.message, 422);
    }
    console.error("[POST /api/rental/send-email/bulk]", err);
    return apiServerError();
  }
}
