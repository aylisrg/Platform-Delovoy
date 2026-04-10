import { AdminHeader } from "@/components/admin/header";
import { ClientsPageContent } from "@/components/admin/clients/clients-page-content";

export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return (
    <>
      <AdminHeader title="Клиенты" />
      <div className="p-8">
        <ClientsPageContent />
      </div>
    </>
  );
}
