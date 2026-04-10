import { auth } from "@/lib/auth";
import { apiResponse, apiUnauthorized, apiServerError, requireAdminSection } from "@/lib/api-response";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  const denied = await requireAdminSection(session, "architect");
  if (denied) return denied;

  try {
    const modules = await prisma.module.findMany({ orderBy: { name: "asc" } });
    return apiResponse(modules);
  } catch {
    return apiServerError();
  }
}
