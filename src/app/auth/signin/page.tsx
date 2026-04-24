"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type AuthView = "main" | "email";
type EmailMode = "password" | "magic-link";
type EmailSubView = "form" | "magic-link-sent" | "auto-signing-in";

// Telegram Login Widget component
function TelegramLoginButton() {
  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME;

  useEffect(() => {
    if (!botName) return;

    // Define the global callback
    (window as unknown as Record<string, unknown>).onTelegramAuth = async (user: Record<string, string>) => {
      await signIn("telegram", {
        ...user,
        redirect: true,
        callbackUrl: "/auth/redirect",
      });
    };

    // Load Telegram widget script
    const container = document.getElementById("telegram-login");
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.async = true;
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).onTelegramAuth;
    };
  }, [botName]);

  if (!botName) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl bg-[#26A5E4]/10 border border-[#26A5E4]/20 px-4 py-4">
        <TelegramIcon />
        <span className="text-sm text-[#26A5E4]">Telegram-вход временно недоступен</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-[#26A5E4] mb-1">
        <TelegramIcon />
        <span className="text-sm font-medium">Быстрый вход через Telegram</span>
      </div>
      <div id="telegram-login" className="flex justify-center" />
    </div>
  );
}

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
      window.location.href = "/";
    }
  }, []);

  // Ping server-side provider status on mount — triggers admin alert if
  // Telegram (primary login channel) is misconfigured. Fire-and-forget.
  useEffect(() => {
    fetch("/api/auth/providers-status").catch(() => {});
  }, []);

  // Handle magic link redirect: ?magic=userId
  useEffect(() => {
    const magicUserId = searchParams.get("magic");
    if (!magicUserId) return;

    setView("email");
    setEmailSubView("auto-signing-in");

    signIn("magic-link", { userId: magicUserId, redirect: false }).then(
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

  const handleOAuthLogin = useCallback(async (provider: string) => {
    setError("");
    setLoading(true);
    await signIn(provider, { callbackUrl: "/auth/redirect" });
  }, []);

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
              {/* Telegram — primary */}
              <TelegramLoginButton />

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-zinc-700/50" />
                <span className="text-xs text-zinc-500">или</span>
                <div className="flex-1 h-px bg-zinc-700/50" />
              </div>

              {/* Auth buttons */}
              <div className="space-y-2.5">
                <button
                  onClick={() => handleOAuthLogin("yandex")}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  <YandexIcon />
                  Войти через Яндекс
                </button>

                <button
                  onClick={() => { setView("email"); setEmailSubView("form"); setError(""); }}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
                >
                  <MailIconSmall />
                  Войти по Email
                </button>
              </div>

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

function YandexIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#FC3F1D" />
      <path d="M13.63 19.2h2.05V4.8h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38l-3.06 6h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V19.2z" fill="white" />
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

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#26A5E4" />
      <path d="M17.05 7.26l-1.83 9.43c-.14.62-.5.77-.99.48l-2.78-2.05-1.34 1.29c-.15.15-.27.27-.56.27l.2-2.83 5.15-4.65c.22-.2-.05-.31-.35-.12l-6.36 4.01-2.74-.85c-.59-.19-.61-.59.12-.88l10.72-4.13c.5-.19.94.12.76.88z" fill="white" />
    </svg>
  );
}
