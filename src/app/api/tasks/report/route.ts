import { NextRequest, NextResponse } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiValidationError,
} from "@/lib/api-response";
import { reportTaskSchema } from "@/modules/tasks/validation";
import {
  OfficeAmbiguousError,
  submitPublicReport,
} from "@/modules/tasks/report-service";
import {
  getClientIp,
  rateLimitCustom,
} from "@/modules/tasks/rate-limit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = await rateLimitCustom(ip, "tasks-report", 5, 60 * 60);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const parsed = reportTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }

    try {
      const result = await submitPublicReport(parsed.data, {
        ip,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return apiResponse(
        {
          publicId: result.publicId,
          trackingUrl: `/track/${result.publicId}`,
        },
        undefined,
        201
      );
    } catch (err) {
      if (err instanceof OfficeAmbiguousError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "OFFICE_AMBIGUOUS",
              message: err.message,
              details: { candidates: err.candidates },
            },
          },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch {
    return apiServerError();
  }
}
