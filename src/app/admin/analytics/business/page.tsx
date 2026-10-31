import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getBusinessViewer } from "@/modules/analytics/business-access";
import { businessQuerySchema } from "@/modules/analytics/business-validation";
import { BusinessAnalytics } from "@/components/admin/business-analytics";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Бизнес-аналитика · Деловой", robots: { index: false, follow: false } };

export default async function BusinessAnalyticsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const session = await auth();
  if (!session?.user?.id) {
    const raw = await searchParams;
    const query = businessQuerySchema.safeParse({ period: raw?.period, weekEnding: raw?.weekEnding });
    let callback = "/admin/analytics/business";
    if (query.success && (raw?.period || raw?.weekEnding)) {
      const params = new URLSearchParams({ period: query.data.period });
      if (query.data.weekEnding) params.set("weekEnding", query.data.weekEnding);
      callback += `?${params}`;
    }
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
  }
  const viewer = await getBusinessViewer(session.user.id);
  if (!viewer) redirect("/admin/forbidden");
  return <BusinessAnalytics />;
}
