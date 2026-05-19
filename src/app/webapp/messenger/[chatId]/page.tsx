import type * as React from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import WebappMessengerClient from "../WebappMessengerClient";

export const metadata = { title: "Чат — Деловой Парк" };

type PageProps = {
  params: Promise<{ chatId: string }>;
};

export default async function WebappMessengerChatPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) redirect("/webapp/link-account");
  const { chatId } = await params;

  return (
    <WebappMessengerClient
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? null}
      initialChatId={chatId}
    />
  );
}
