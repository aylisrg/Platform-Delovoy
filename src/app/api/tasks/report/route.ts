import { NextRequest, NextResponse } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { PublicReportSchema } from "@/modules/tasks/validation";
import { matchOffice } from "@/modules/tasks/office-matcher";
import { createTask } from "@/modules/tasks/service";
import { log } from "@/lib/logger";

/**
 * POST /api/tasks/report
 *
 * Public endpoint for tenants to submit an issue via the web form.
 * Rate-limited by IP. No auth required.
 *
 * Response codes:
 *  - 201 on success
 *  - 422 validation error
 *  - 429 rate limit
 *  - 409 OFFICE_AMBIGUOUS with candidates list — client prompts user to choose
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, "public");
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = PublicReportSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const {
      name,
      contactEmail,
      contactPhone,
      officeInput,
      officeId,
      categorySlug,
      description,
      photoUrl,
    } = parsed.data;

    // Resolve office
    let resolvedOfficeId: string | null = null;
    if (officeId) {
      const exists = await prisma.office.findUnique({
        where: { id: officeId },
        select: { id: true },
      });
      if (exists) resolvedOfficeId = exists.id;
    }

    if (!resolvedOfficeId) {
      const offices = await prisma.office.findMany({
        select: { id: true, number: true, building: true, floor: true },
      });
      const result = matchOffice(officeInput, offices);
      if (result.exact) {
        resolvedOfficeId = result.exact.id;
      } else if (result.candidates.length > 0) {
        // 409 + structured payload: the client shows these as clickable buttons
        // so the user picks one and re-submits with officeId set.
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "OFFICE_AMBIGUOUS",
              message: "Не удалось однозначно определить офис — уточните",
            },
            data: {
              candidates: result.candidates.map((o) => ({
                id: o.id,
                number: o.number,
                building: o.building,
                floor: o.floor,
              })),
            },
          },
          { status: 409 }
        );
      }
      // No match at all → proceed without office, flag in metadata
    }

    // If reporter's email matches an existing User, link it
    let reporterUserId: string | null = null;
    if (contactEmail) {
      const existing = await prisma.user.findUnique({
        where: { email: contactEmail.toLowerCase() },
        select: { id: true },
      });
      if (existing) reporterUserId = existing.id;
    }

    // Infer tenant via active RentalContract on the office (if resolved)
    let externalTenantId: string | null = null;
    if (resolvedOfficeId) {
      const active = await prisma.rentalContract.findFirst({
        where: {
          officeId: resolvedOfficeId,
          status: { in: ["ACTIVE", "EXPIRING"] },
        },
        select: { tenantId: true },
        orderBy: { startDate: "desc" },
      });
      if (active) externalTenantId = active.tenantId;
    }

    let categoryId: string | null = null;
    if (categorySlug) {
      const cat = await prisma.taskCategory.findUnique({
        where: { slug: categorySlug },
        select: { id: true, isActive: true },
      });
      if (cat?.isActive) categoryId = cat.id;
    }

    const title = description.slice(0, 100) + (description.length > 100 ? "…" : "");

    const task = await createTask(
      {
        type: "ISSUE",
        source: "WEB",
        title: `[Офис] ${title}`,
        description,
        priority: "MEDIUM",
        categoryId,
        labels: [],
        reporterUserId,
        externalTenantId,
        externalOfficeId: resolvedOfficeId,
        externalContact: {
          name,
          email: contactEmail,
          phone: contactPhone,
        },
        metadata: photoUrl ? { photoUrl, officeInput } : { officeInput },
      },
      { id: reporterUserId, source: reporterUserId ? "user" : "system" }
    );

    await log.info("tasks.report", `New web report: ${task.publicId}`, {
      source: "WEB",
      officeId: resolvedOfficeId,
    });

    return apiResponse(
      {
        publicId: task.publicId,
        status: task.status,
      },
      undefined,
      201
    );
  } catch (err) {
    console.error("[POST /api/tasks/report]", err);
    return apiServerError();
  }
}
