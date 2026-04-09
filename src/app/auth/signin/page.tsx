"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

type AuthTab = "social" | "email" | "phone";

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
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).onTelegramAuth;
    };
  }, [botName]);

  if (!botName) {
    return (
      <button
        disabled
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-400 cursor-not-allowed"
      >
        <TelegramIcon />
        Telegram (не настроен)
      </button>
    );
  }

  return <div id="telegram-login" className="flex justify-center" />;
}

export default function SignInPage() {
  const [tab, setTab] = useState<AuthTab>("social");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Неверный email или пароль");
      setLoading(false);
    } else {
      window.location.href = "/auth/redirect";
    }
  }, [email, password]);

  const handlePhoneLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // Phone auth placeholder — needs SMS provider
    setError("Вход по телефону скоро будет доступен. Используйте другой способ входа.");
  }, []);

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
          {/* Tabs */}
          <div className="mb-6 flex rounded-xl bg-zinc-800/50 p-1">
            {([
              { key: "social" as AuthTab, label: "Соцсети" },
              { key: "email" as AuthTab, label: "Email" },
              { key: "phone" as AuthTab, label: "Телефон" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setError(""); }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Social login */}
          {tab === "social" && (
            <div className="space-y-3">
              {/* Google */}
              <button
                onClick={() => handleOAuthLogin("google")}
                disabled={loading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                <GoogleIcon />
                Войти через Google
              </button>

              {/* Yandex */}
              <button
                onClick={() => handleOAuthLogin("yandex")}
                disabled={loading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                <YandexIcon />
                Войти через Яндекс
              </button>

              {/* VK (Max) */}
              <button
                onClick={() => handleOAuthLogin("vk")}
                disabled={loading}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                <VKIcon />
                Войти через VK
              </button>

              {/* Telegram */}
              <TelegramLoginButton />

              {error && <p className="text-center text-sm text-red-400">{error}</p>}

              <p className="pt-2 text-center text-xs text-zinc-500">
                При первом входе аккаунт создаётся автоматически
              </p>
            </div>
          )}

          {/* Email login */}
          {tab === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
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
                  className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="you@example.com"
                />
              </div>
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
                  className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="••••••••"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Вход..." : "Войти"}
              </button>
            </form>
          )}

          {/* Phone login */}
          {tab === "phone" && (
            <form onSubmit={handlePhoneLogin} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-zinc-300">
                  Номер телефона
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="mt-1 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="+7 (999) 123-45-67"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                Получить код
              </button>

              <p className="text-center text-xs text-zinc-500">
                SMS-верификация скоро будет доступна
              </p>
            </form>
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

// --- SVG Icons ---

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function YandexIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#FC3F1D" />
      <path
        d="M13.63 19.2h2.05V4.8h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38l-3.06 6h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V19.2z"
        fill="white"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#26A5E4" />
      <path
        d="M18.92 6.09L4.75 11.67c-.97.39-.96.93-.18 1.17l3.64 1.14 1.41 4.33c.17.48.09.67.54.67.35 0 .5-.16.7-.35l1.68-1.63 3.49 2.58c.64.35 1.1.17 1.26-.6l2.28-10.72c.23-.92-.35-1.34-1-.97z"
        fill="white"
      />
    </svg>
  );
}
