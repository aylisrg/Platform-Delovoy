import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/permissions";
import AdminMessengerClient from "./AdminMessengerClient";

export const metadata = { title: "Мессенджер — Деловой Парк" };

export default async function AdminMessengerPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (!hasRole(session.user, "MANAGER")) redirect("/admin/forbidden");

  return (
    <AdminMessengerClient
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? null}
      isAdmin={true}
    />
  );
}
