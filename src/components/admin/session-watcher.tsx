"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Closes the "open tab" gap of JWT sessions (ADR 2026-10-25 §Q1 п.5): the
 * proxy has no DB, so a revoked staff member keeps a stale cookie until
 * something hits the full `auth.ts` callback. `/api/auth/session` does — and
 * re-encodes the cookie with fresh claims. Polling it every 30 s (and on
 * focus) bounds the delay to ≤ 30 s, inside the 60 s budget of AC-A1.5.
 */
export const SESSION_WATCH_INTERVAL_MS = 30_000;

type SessionLike = { user?: { role?: string; adminSections?: string[] } } | null;

/** Stable fingerprint of what gates admin access; `null` = signed out. */
export function sessionFingerprint(session: SessionLike): string | null {
  const user = session?.user;
  if (!user?.role) return null;
  const sections = [...(user.adminSections ?? [])].sort().join(",");
  return `${user.role}|${sections}`;
}

export function SessionWatcher() {
  const router = useRouter();
  const baseline = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let stopped = false;

    async function check() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok || stopped) return;
        const fingerprint = sessionFingerprint((await res.json()) as SessionLike);
        if (stopped) return;
        if (fingerprint === null) {
          const back = encodeURIComponent(window.location.pathname + window.location.search);
          router.replace(`/auth/signin?callbackUrl=${back}`);
          return;
        }
        if (baseline.current === undefined) {
          baseline.current = fingerprint;
        } else if (fingerprint !== baseline.current) {
          // Role or sections changed — the proxy now sees the refreshed cookie.
          window.location.reload();
        }
      } catch {
        // offline / transient — next tick retries
      }
    }

    void check();
    const timer = window.setInterval(check, SESSION_WATCH_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}
