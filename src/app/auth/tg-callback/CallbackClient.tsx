"use client";

/**
 * Client-side wrapper for /auth/tg-callback.
 *
 * Two modes:
 *
 *   "signin"   — server already consumed the token + minted a one-time
 *                JWT. We auto-call signIn("telegram-token", ...) on
 *                mount and redirect to /profile on success.
 *
 *   "conflict" — current browser session belongs to a different userId
 *                than the token's userId. We render a confirmation UI;
 *                user chooses to either:
 *                   - sign out + open the same callback URL again
 *                     (which then takes the anonymous "signin" branch
 *                     of the server component), or
 *                   - cancel and keep the current session.
 *                The token itself stays PENDING here — its 5-min TTL
 *                handles cleanup if the user walks away.
 */
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

type Props =
  | { mode: "signin"; token: string; oneTimeCode: string }
  | {
      mode: "conflict";
      token: string;
      currentDisplayName: string;
      oneTimeCode?: never;
    };

export function CallbackClient(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const triggered = useRef(false);

  useEffect(() => {
    if (props.mode !== "signin") return;
    if (triggered.current) return;
    triggered.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await signIn("telegram-token", {
          oneTimeCode: props.oneTimeCode,
          redirect: false,
        });
        if (cancelled) return;
        if (res?.error) {
          setError(
            "Не удалось завершить вход. Откройте Telegram-бот и нажмите «🌐 Открыть сайт» ещё раз."
          );
          return;
        }
        // Hard reload to /profile so the server component picks up the
        // freshly written next-auth cookie reliably across browsers.
        window.location.href = "/profile";
      } catch {
        if (cancelled) return;
        setError("Произошла ошибка при входе. Попробуйте ещё раз.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props]);

  if (props.mode === "signin") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-neutral-950 text-neutral-100">
        <div className="max-w-md w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl text-center">
          {error ? (
            <>
              <h1 className="text-xl font-semibold mb-3">Ошибка входа</h1>
              <p className="text-neutral-400 text-sm leading-relaxed mb-6">
                {error}
              </p>
              <Link
                href="/auth/signin"
                className="block text-center rounded-xl bg-neutral-100 text-neutral-900 px-4 py-2.5 text-sm font-medium hover:bg-white transition"
              >
                Войти заново
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold mb-3">Входим в систему…</h1>
              <p className="text-neutral-400 text-sm leading-relaxed">
                Подождите секунду — мы открываем ваш аккаунт.
              </p>
            </>
          )}
        </div>
      </main>
    );
  }

  // mode === "conflict"
  const handleSwitch = async () => {
    // Sign out without redirect, then reload the callback URL — the
    // server component will see no session and proceed with the
    // anonymous signIn branch using the same token. The token is still
    // PENDING because we haven't consumed it on this branch.
    await signOut({ redirect: false });
    window.location.reload();
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-neutral-950 text-neutral-100">
      <div className="max-w-md w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <h1 className="text-xl font-semibold mb-3">Сменить аккаунт?</h1>
        <p className="text-neutral-400 text-sm leading-relaxed mb-6">
          Сейчас вы вошли как{" "}
          <span className="text-neutral-100 font-medium">
            {props.currentDisplayName}
          </span>
          . Ссылка из Telegram-бота откроет другой аккаунт. Что делаем?
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleSwitch}
            className="rounded-xl bg-neutral-100 text-neutral-900 px-4 py-2.5 text-sm font-medium hover:bg-white transition"
          >
            Войти под другим аккаунтом
          </button>
          <Link
            href="/profile"
            className="rounded-xl border border-neutral-700 text-neutral-200 px-4 py-2.5 text-sm font-medium text-center hover:bg-neutral-800 transition"
          >
            Остаться как {props.currentDisplayName}
          </Link>
        </div>
      </div>
    </main>
  );
}
