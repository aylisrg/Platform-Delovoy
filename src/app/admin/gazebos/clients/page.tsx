import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { ClientsList } from "@/components/admin/clients/clients-list";
import { listClients } from "@/modules/clients/service";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";

// F8: per-module guests view for gazebos. Mirrors /admin/ps-park/clients.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function GazebosClientsListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const allowed = await hasAdminSectionAccess(session.user.id, "gazebos");
  if (!allowed) redirect("/admin");

  const { clients, total } = await listClients({
    moduleSlug: "gazebos",
    limit: PAGE_SIZE,
    offset: 0,
    sortBy: "lastActivity",
    sortOrder: "desc",
  });

  return (
    <>
      <AdminHeader title="Гости Барбекю Парка" />
      <div className="p-8">
        <ClientsList
          initialClients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            bookingCount: c.bookingCount,
            totalSpent: c.totalSpent,
            lastActivityAt: c.lastActivityAt,
            createdAt: c.createdAt,
          }))}
          initialTotal={total}
          pageSize={PAGE_SIZE}
          moduleSlug="gazebos"
        />
      </div>
    </>
  );
}
