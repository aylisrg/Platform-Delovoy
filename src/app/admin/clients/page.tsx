import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { ClientsList } from "@/components/admin/clients/clients-list";
import { listClients } from "@/modules/clients/service";
import { auth } from "@/lib/auth";
import { hasAdminSectionAccess } from "@/lib/permissions";

// F4 ADR — replaces previous redirect stub. The /admin/users?tab=clients
// view is gone; this is now the canonical guests directory.
//
// F8 RBAC: only users with explicit `clients` section grant see the global
// directory. Module-only managers go to /admin/ps-park/clients or
// /admin/gazebos/clients instead.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ClientsListPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const allowed = await hasAdminSectionAccess(session.user.id, "clients");
  if (!allowed) redirect("/admin");

  const { clients, total } = await listClients({
    limit: PAGE_SIZE,
    offset: 0,
    sortBy: "lastActivity",
    sortOrder: "desc",
  });

  return (
    <>
      <AdminHeader title="Гости (CRM)" />
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
        />
      </div>
    </>
  );
}
