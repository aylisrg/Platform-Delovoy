import { AdminHeader } from "@/components/admin/header";
import { ClientProfile } from "@/components/admin/clients/client-profile";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <AdminHeader title="Профиль клиента" />
      <div className="p-8">
        <ClientProfile clientId={id} />
      </div>
    </>
  );
}
