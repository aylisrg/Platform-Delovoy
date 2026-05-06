import { redirect, notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { ClientProfile } from "@/components/admin/clients/client-profile";
import { auth } from "@/lib/auth";
import { canViewClient } from "@/modules/clients/service";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // F8 RBAC: previously this page had NO server-side guard at all — any
  // authenticated user could view any guest's full profile by direct URL.
  // Now we require either the explicit `clients` section grant OR an
  // overlap between the viewer's module sections and the guest's actual
  // booking/order modules.
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canViewClient(session.user.id, id);
  if (!allowed) notFound();

  return (
    <>
      <AdminHeader title="Профиль клиента" />
      <div className="p-8">
        <ClientProfile clientId={id} />
      </div>
    </>
  );
}
