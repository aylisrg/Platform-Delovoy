import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { apiUnauthorized } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/permissions";
import { getSaunaHealth } from "@/modules/sauna/health";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const ok = await hasModuleAccess(session.user.id, "sauna");
  if (!ok)
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Нет доступа" } },
      { status: 403 }
    );
  return NextResponse.json({ success: true, data: getSaunaHealth() });
}
