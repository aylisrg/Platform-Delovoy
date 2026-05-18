import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/permissions";
import AdminMessengerClient from "../AdminMessengerClient";

export const metadata = { title: "Мессенджер — Деловой Парк" };

type Params = { params: Promise<{ chatId: string }> };

export default async function AdminMessengerChatPage({ params }: Params) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (!hasRole(session.user, "MANAGER")) redirect("/admin/forbidden");

  const { chatId } = await params;

  return (
    <AdminMessengerClient
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? null}
      isAdmin={true}
      initialChatId={chatId}
    />
  );
}
