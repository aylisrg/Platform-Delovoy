import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminHeader } from "@/components/admin/header";
import { UserProfilePage } from "@/components/admin/users/profile/user-profile-page";

export const dynamic = "force-dynamic";

/**
 * Страница сотрудника (US-B1, ADR 2026-10-25-team-access-notifications §7).
 * SUPERADMIN only, even with the «Пользователи» section (AC-B1.1).
 */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/admin/users/${id}`)}`);
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");

  return (
    <>
      <AdminHeader title="Сотрудник" />
      <div className="p-4 sm:p-8">
        <UserProfilePage userId={id} />
      </div>
    </>
  );
}
