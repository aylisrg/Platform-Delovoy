"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TelegramSignInBlock } from "@/components/auth/telegram-polling";

type AuthView = "main" | "email";
type EmailMode = "password" | "magic-link";
type EmailSubView = "form" | "magic-link-sent" | "auto-signing-in";

// Inner component that uses useSearchParams (requires Suspense boundary)
function SignInInner() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<AuthView>("main");
  const [emailMode, setEmailMode] = useState<EmailMode>("password");
  const [emailSubView, setEmailSubView] = useState<EmailSubView>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const redirectAfterLogin = useCallback(async () => {
    const sessionRes = await fetch("/api/auth/session");
    const session = await sessionRes.json();
    const role = session?.user?.role;
    if (role === "SUPERADMIN" || role === "ADMIN" || role === "MANAGER") {
      window.location.href = "/admin/dashboard";
    } else {
      window.location.href = "/dashboard";
    }
  }, []);

  // Ping server-side provider status on mount — triggers admin alert if
  // Telegram (primary login channel) is misconfigured. Fire-and-forget.
  useEffect(() => {
    fetch("/api/auth/providers-status").catch(() => {});
  }, []);

  // Handle magic link redirect: ?magic=<one-time signin nonce>
  // (Previously this carried userId — that was the security hole. Now
  // it carries a Redis-backed nonce that the magic-link Credentials
  // provider consumes atomically.)
  useEffect(() => {
    const magicNonce = searchParams.get("magic");
    if (!magicNonce) return;

    setView("email");
    setEmailSubView("auto-signing-in");

    signIn("magic-link", { nonce: magicNonce, redirect: false }).then(
      async (result) => {
        if (result?.ok) {
          await redirectAfterLogin();
        } else {
          setEmailSubView("form");
          setError("Ссылка недействительна или уже была использована");
        }
      }
    );
  }, [searchParams, redirectAfterLogin]);

  // Handle error params from verify-email redirect
  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (!errorParam) return;

    setView("email");
    setEmailSubView("form");
    if (errorParam === "link-expired") {
      setError("Ссылка истекла. Запросите новую.");
    } else if (errorParam === "invalid-link") {
      setError("Недействительная ссылка. Запросите новую.");
    }
  }, [searchParams]);

  const handlePasswordLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.ok) {
      await redirectAfterLogin();
      return;
    }

    setError("Неверный email или пароль");
    setLoading(false);
  }, [email, password, redirectAfterLogin]);

  const handleMagicLinkRequest = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error?.message || "Не удалось отправить письмо");
        setLoading(false);
        return;
      }

      setEmailSubView("magic-link-sent");
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">Деловой Парк</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Войдите для бронирования и доступа к сервисам
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">

          {/* Main view — Telegram first */}
          {view === "main" && (
            <div className="space-y-5">
              {/* Telegram — primary, Wave 2 deep-link flow */}
              <TelegramSignInBlock callbackUrl="/auth/redirect" />

              {/* Divider — collapsed "Other ways" */}
              <details className="group">
                <summary className="cursor-pointer list-none text-center text-xs text-zinc-500 hover:text-zinc-300">
                  <span className="group-open:hidden">Другие способы</span>
                  <span className="hidden group-open:inline">Скрыть</span>
                </summary>

                <div className="mt-3 space-y-2.5">
                  <button
                    onClick={() => { setView("email"); setEmailSubView("form"); setError(""); }}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
                  >
                    <MailIconSmall />
                    Войти по Email
                  </button>
                </div>
              </details>

              {error && <p className="text-center text-sm text-red-400">{error}</p>}

              <p className="pt-1 text-center text-xs text-zinc-500">
                При первом входе аккаунт создаётся автоматически
              </p>
            </div>
          )}

          {/* Email flow */}
          {view === "email" && (
            <div className="space-y-4">
              {emailSubView !== "auto-signing-in" && (
                <button
                  onClick={() => { setView("main"); setEmailSubView("form"); setError(""); }}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  ← Назад
                </button>
              )}

              {/* Form sub-view */}
              {emailSubView === "form" && (
                <div className="space-y-4">
                  {/* Mode toggle — explicit choice between password and magic-link */}
                  <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-800 p-1">
                    <button
                      role="tab"
                      aria-selected={emailMode === "password"}
                      type="button"
                      onClick={() => { setEmailMode("password"); setError(""); }}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        emailMode === "password"
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      С паролем
                    </button>
                    <button
                      role="tab"
                      aria-selected={emailMode === "magic-link"}
                      type="button"
                      onClick={() => { setEmailMode("magic-link"); setError(""); setPassword(""); }}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        emailMode === "magic-link"
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Ссылка на почту
                    </button>
                  </div>

                  <form
                    onSubmit={emailMode === "password" ? handlePasswordLogin : handleMagicLinkRequest}
                    className="space-y-4"
                  >
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
                        Email
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="you@example.com"
                      />
                    </div>

                    {emailMode === "password" && (
                      <div>
                        <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
                          Пароль
                        </label>
                        <input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="••••••••"
                        />
                      </div>
                    )}

                    {error && <p className="text-sm text-red-400">{error}</p>}

                    <button
                      type="submit"
                      disabled={loading || !email || (emailMode === "password" && !password)}
                      className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      {loading
                        ? "Отправка..."
                        : emailMode === "password"
                          ? "Войти"
                          : "Отправить ссылку"}
                    </button>

                    {emailMode === "magic-link" && (
                      <p className="text-center text-xs text-zinc-500">
                        Пришлём одноразовую ссылку для входа. Если аккаунта нет — создадим при переходе.
                      </p>
                    )}
                  </form>
                </div>
              )}

              {/* Magic link sent sub-view */}
              {emailSubView === "magic-link-sent" && (
                <div className="space-y-4 text-center">
                  <div className="flex justify-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/10">
                      <MailIcon />
                    </div>
                  </div>
                  <div>
                    <p className="text-base font-medium text-white">Проверьте почту</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Отправили письмо на{" "}
                      <span className="text-white font-medium">{email}</span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Перейдите по ссылке в письме — ссылка действительна 15 минут
                    </p>
                  </div>
                  <button
                    onClick={() => { setEmailSubView("form"); setError(""); }}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Изменить email или отправить повторно
                  </button>
                </div>
              )}

              {/* Auto-signing-in sub-view */}
              {emailSubView === "auto-signing-in" && (
                <div className="space-y-4 text-center py-4">
                  <div className="flex justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  </div>
                  <p className="text-sm text-zinc-400">Выполняется вход...</p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer link */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-white">
            ← На главную
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    }>
      <SignInInner />
    </Suspense>
  );
}

// --- SVG Icons ---

function MailIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 7 10-7" />
    </svg>
  );
}

function MailIconSmall() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#3b82f6" />
      <rect x="4" y="6" width="16" height="12" rx="1.5" stroke="white" strokeWidth="1.5" fill="none" />
      <path d="M4 8l8 5 8-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

