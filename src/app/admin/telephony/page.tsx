import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { CallsDashboard } from "@/components/admin/telephony/calls-dashboard";
import type { TelephonyCallFilter } from "@/modules/telephony/dashboard-types";

export const dynamic = "force-dynamic";

export default async function TelephonyPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");
  const { filter } = await searchParams;
  const allowedFilters: TelephonyCallFilter[] = ["all", "inbound", "answered", "missed", "outbound"];
  const initialFilter = allowedFilters.find((value) => value === filter) ?? "all";

  return (
    <>
      <AdminHeader title="Звонки" />
      <CallsDashboard initialFilter={initialFilter} />
    </>
  );
}
