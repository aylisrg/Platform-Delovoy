import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyWebAppToken } from "@/lib/webapp-auth";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { getBusinessViewer } from "./business-access";
import { businessQuerySchema, businessPreferenceSchema, businessTestSchema } from "./business-validation";
import { getBusinessReport, businessCsv } from "./business-service";
import { getBusinessPreference, setBusinessPreference, sendBusinessTest, BusinessReportError } from "./business-reports";
import { rateLimit } from "@/lib/rate-limit";
export type BusinessAction = "report" | "export" | "preference" | "test";
const privateResponse = (response: NextResponse) => {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
};
/** Shared thin route adapter. Every surface rechecks live RBAC before data access. */
export async function businessHttp(request: NextRequest, action: BusinessAction, miniapp = false) {
  try {
    const identity = miniapp ? await verifyWebAppToken(request) : (await auth())?.user;
    if (!identity?.id) return privateResponse(apiError("UNAUTHORIZED", "Войдите в аккаунт", 401));
    const viewer = await getBusinessViewer(identity.id);
    if (!viewer) return privateResponse(apiError("FORBIDDEN", "Нет доступа к бизнес-аналитике", 403));
    if (action === "test" || request.method === "PUT") {
      const limited = await rateLimit(request, "authenticated", viewer.id);
      if (limited) return privateResponse(limited);
    }
    if (action === "report" || action === "export") {
      const parsed = businessQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!parsed.success) return privateResponse(apiError("VALIDATION_ERROR", "Некорректный период", 422));
      const anchor = parsed.data.weekEnding ? new Date(new Date(`${parsed.data.weekEnding}T00:00:00+03:00`).getTime() + 86_400_000) : new Date();
      const report = await getBusinessReport(parsed.data.period, anchor, action !== "export");
      if (action === "export") return privateResponse(new NextResponse(businessCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="business-analytics.csv"', "X-Content-Type-Options": "nosniff" } }));
      return privateResponse(apiResponse(report));
    }
    if (action === "preference") {
      if (request.method === "GET") return privateResponse(apiResponse(await getBusinessPreference(viewer.id)));
      const parsed = businessPreferenceSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return privateResponse(apiError("VALIDATION_ERROR", "Передайте только enabled", 422));
      return privateResponse(apiResponse(await setBusinessPreference(viewer.id, parsed.data.enabled)));
    }
    const parsed = businessTestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return privateResponse(apiError("VALIDATION_ERROR", "Некорректный идентификатор теста", 422));
    return privateResponse(apiResponse(await sendBusinessTest(viewer.id, parsed.data.requestId)));
  } catch (error) {
    if (error instanceof BusinessReportError) return privateResponse(apiError(error.code, error.message, error.status));
    return privateResponse(apiServerError());
  }
}
