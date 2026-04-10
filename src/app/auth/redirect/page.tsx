"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

export default function AuthRedirectPage() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    if (!session?.user) {
      window.location.href = "/auth/signin";
      return;
    }

    const role = session.user.role;
    if (role === "SUPERADMIN" || role === "MANAGER") {
      window.location.href = "/admin/dashboard";
    } else {
      window.location.href = "/";
    }
  }, [session, status]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
        <p className="text-sm text-zinc-400">Перенаправление...</p>
      </div>
    </div>
  );
}
