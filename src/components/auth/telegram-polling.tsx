"use client";

/**
 * Telegram deep-link sign-in client hook + UI block.
 *
 * State machine: idle → starting → waiting → confirming → done | error
 *
 *   idle      — initial; "Войти через Telegram" button visible.
 *   starting  — POST /api/auth/telegram/start in flight.
 *   waiting   — token issued, deep link opened, polling /status every 2s.
 *   confirming — got oneTimeCode, calling signIn("telegram-token", …).
 *   done      — sign-in succeeded; parent navigates away (we just clean up).
 *   error     — terminal; user clicks "Попробовать снова" to reset.
 *
 * Why polling and not SSE: the route handler runs on Next.js
 * runtime workers — long-lived SSE connections are awkward both on
 * Vercel (function timeout) and on our PM2 setup (worker pool). 2s
 * polling for 5 minutes = ≤150 hits per attempt, well under the
 * 30/min per-token rate limit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

export type TelegramAuthState =
  | "idle"
  | "starting"
  | "waiting"
  | "confirming"
  | "done"
  | "error";

export type UseTelegramAuthOptions = {
  callbackUrl?: string;
  onDone?: () => void;
};

export function useTelegramAuth({ callbackUrl, onDone }: UseTelegramAuthOptions = {}) {
  const [state, setState] = useState<TelegramAuthState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const pollingRef = useRef<{ token: string; startedAt: number; timer: ReturnType<typeof setTimeout> | null } | null>(
    null
  );

  const stopPolling = useCallback(() => {
    const ref = pollingRef.current;
    if (ref?.timer) clearTimeout(ref.timer);
    pollingRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState("idle");
    setError(null);
    setDeepLink(null);
  }, [stopPolling]);

  // Cleanup on unmount.
  useEffect(() => () => stopPolling(), [stopPolling]);

  const start = useCallback(async () => {
    setError(null);
    setState("starting");
    try {
      const res = await fetch("/api/auth/telegram/start", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setError(body?.error?.message ?? "Не удалось получить ссылку");
        setState("error");
        return;
      }
      const token = body.data.token as string;
      const link = body.data.deepLink as string;
      setDeepLink(link);
      setState("waiting");

      // Open in a new tab on desktop; on mobile this goes straight into
      // the Telegram app via the t.me protocol handler.
      if (typeof window !== "undefined") {
        window.open(link, "_blank", "noopener");
      }

      pollingRef.current = { token, startedAt: Date.now(), timer: null };
      const tick = async () => {
        const ref = pollingRef.current;
        if (!ref) return; // unmounted / reset
        if (Date.now() - ref.startedAt > MAX_POLL_DURATION_MS) {
          stopPolling();
          setError("Время ожидания истекло. Попробуй ещё раз.");
          setState("error");
          return;
        }

        try {
          const r = await fetch(
            `/api/auth/telegram/status?token=${encodeURIComponent(ref.token)}`
          );
          const data = await r.json();
          if (!r.ok || !data?.success) {
            // Transient error — keep polling unless we've timed out.
            ref.timer = setTimeout(tick, POLL_INTERVAL_MS);
            return;
          }
          const status = data.data.status as
            | "pending"
            | "confirmed"
            | "consumed"
            | "expired";
          if (status === "pending") {
            ref.timer = setTimeout(tick, POLL_INTERVAL_MS);
            return;
          }
          if (status === "expired") {
            stopPolling();
            setError("Ссылка устарела. Нажми «Войти через Telegram» ещё раз.");
            setState("error");
            return;
          }
          if (status === "consumed") {
            stopPolling();
            setError(
              "Ссылка уже использована. Нажми «Войти через Telegram» ещё раз."
            );
            setState("error");
            return;
          }
          // confirmed
          stopPolling();
          setState("confirming");
          const oneTimeCode = data.data.oneTimeCode as string;
          const result = await signIn("telegram-token", {
            oneTimeCode,
            redirect: false,
            callbackUrl,
          });
          if (result?.ok) {
            setState("done");
            if (onDone) onDone();
            else if (typeof window !== "undefined") {
              window.location.href = result.url ?? callbackUrl ?? "/";
            }
          } else {
            setError("Не удалось завершить вход. Попробуй ещё раз.");
            setState("error");
          }
        } catch {
          // Network blip — try again next tick unless timed out.
          ref.timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };
      pollingRef.current.timer = setTimeout(tick, POLL_INTERVAL_MS);
    } catch {
      setError("Ошибка сети. Попробуй ещё раз.");
      setState("error");
    }
  }, [callbackUrl, onDone, stopPolling]);

  return { state, error, deepLink, start, reset };
}

export function TelegramSignInBlock({
  callbackUrl,
}: {
  callbackUrl?: string;
}) {
  const { state, error, deepLink, start, reset } = useTelegramAuth({
    callbackUrl,
  });

  if (state === "idle" || state === "starting") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={state === "starting"}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#26A5E4] px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-[#1a92cd] disabled:opacity-60"
      >
        <TelegramIcon />
        {state === "starting" ? "Готовим ссылку…" : "Войти через Telegram"}
      </button>
    );
  }

  if (state === "waiting") {
    return (
      <div className="space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#26A5E4] border-t-transparent" />
        <p className="text-sm text-zinc-200">
          Ждём подтверждения в Telegram…
        </p>
        <p className="text-xs text-zinc-400">
          Открой бота и нажми «Поделиться номером».
        </p>
        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-[#26A5E4] underline hover:text-[#5cb8e8]"
          >
            Открыть бота снова
          </a>
        )}
        <button
          type="button"
          onClick={reset}
          className="block w-full text-xs text-zinc-500 hover:text-zinc-300"
        >
          Отмена
        </button>
      </div>
    );
  }

  if (state === "confirming" || state === "done") {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#26A5E4] border-t-transparent" />
        <p className="mt-3 text-sm text-zinc-200">Завершаем вход…</p>
      </div>
    );
  }

  // error
  return (
    <div className="space-y-3 rounded-2xl border border-red-700/40 bg-red-950/30 p-5 text-center">
      <p className="text-sm text-red-300">{error}</p>
      <button
        type="button"
        onClick={reset}
        className="text-sm font-semibold text-[#26A5E4] hover:text-[#5cb8e8]"
      >
        Попробовать снова
      </button>
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="white" fillOpacity="0.15" />
      <path
        d="M17.05 7.26l-1.83 9.43c-.14.62-.5.77-.99.48l-2.78-2.05-1.34 1.29c-.15.15-.27.27-.56.27l.2-2.83 5.15-4.65c.22-.2-.05-.31-.35-.12l-6.36 4.01-2.74-.85c-.59-.19-.61-.59.12-.88l10.72-4.13c.5-.19.94.12.76.88z"
        fill="white"
      />
    </svg>
  );
}
