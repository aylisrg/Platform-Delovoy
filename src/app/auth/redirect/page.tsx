"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

export default function AuthRedirectPage() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;

    if (!session?.user) {
      window.location.href = "/auth/signin";
      return;
    }

    // Support callbackUrl for redirect-after-login.
    // Проверка `startsWith("/")` тут была недостаточной: `//evil.com` и
    // `/\evil.com` её проходят, а браузер уводит на чужой домен — open
    // redirect. Санитайзер общий с /auth/signin.
    const params = new URLSearchParams(window.location.search);
    const target = safeCallbackUrl(
      params.get("callbackUrl"),
      window.location.origin,
    );

    const role = session.user.role;
    if (role === "SUPERADMIN" || role === "ADMIN" || role === "MANAGER") {
      window.location.href = target ?? "/admin/dashboard";
    } else {
      window.location.href = target ?? "/";
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
