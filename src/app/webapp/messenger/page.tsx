import type * as React from "react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import WebappMessengerClient from "./WebappMessengerClient";

export const metadata = { title: "Чаты — Деловой Парк" };

export default async function WebappMessengerPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) redirect("/webapp/link-account");

  return (
    <WebappMessengerClient
      currentUserId={session.user.id}
      currentUserName={session.user.name ?? null}
    />
  );
}
