"use client";

import { signIn } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { TelegramSignInBlock } from "@/components/auth/telegram-polling";

type AuthTab = "telegram" | "other" | "email";
type EmailSubView = "form" | "magic-link-sent";

export function AuthModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AuthTab>("telegram");
  const [emailSubView, setEmailSubView] = useState<EmailSubView>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleEmailLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);

      // Step 1: try credentials login (for users who already have a password)
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.ok) {
        onClose();
        window.location.reload();
        return;
      }

      // Step 2: credentials failed — try magic link flow
      try {
        const res = await fetch("/api/auth/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: password || undefined }),
        });
        const data = await res.json();

        if (!data.success && data.error?.code === "USE_PASSWORD") {
          setError("Неверный email или пароль");
          setLoading(false);
          return;
        }

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
    },
    [email, password, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 sm:mx-auto rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/[0.04] hover:bg-black/[0.08] text-[#86868b] hover:text-[#1d1d1f] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-5 sm:px-8 pt-6 sm:pt-8 pb-2 text-center">
          <h2
            className="font-[family-name:var(--font-manrope)] font-bold text-[#1d1d1f] text-xl"
            style={{ letterSpacing: "-0.4px" }}
          >
            Войдите для бронирования
          </h2>
          <p className="text-[#86868b] text-sm mt-1 font-[family-name:var(--font-inter)]">
            Авторизуйтесь, чтобы отправить заявку
          </p>
        </div>

        {/* Content */}
        <div className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">

          {/* Telegram — primary method, always visible (Wave 2 deep-link flow) */}
          {tab === "telegram" && (
            <div className="space-y-4">
              <TelegramSignInBlock callbackUrl={typeof window !== "undefined" ? window.location.href : "/"} />

              {/* Secondary auth links */}
              <div className="flex justify-center gap-4 pt-1">
                <button
                  onClick={() => { setTab("email"); setError(""); }}
                  className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors font-[family-name:var(--font-inter)]"
                >
                  Email + пароль
                </button>
              </div>

              {error && <p className="text-center text-sm text-red-500">{error}</p>}
              <p className="text-center text-xs text-[#86868b] pt-1">
                Аккаунт создаётся автоматически при первом входе
              </p>
            </div>
          )}

          {/* Email */}
          {tab === "email" && (
            <div className="space-y-3">
              <button
                onClick={() => { setTab("telegram"); setEmailSubView("form"); setError(""); }}
                className="text-sm text-[#0071e3] hover:text-[#0077ED] font-[family-name:var(--font-inter)] mb-1"
              >
                ← Назад
              </button>

              {emailSubView === "form" && (
                <form onSubmit={handleEmailLogin} className="space-y-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="Email"
                    className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm font-[family-name:var(--font-inter)] placeholder-[#86868b]/50 focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Пароль (если есть)"
                    className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm font-[family-name:var(--font-inter)] placeholder-[#86868b]/50 focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20"
                  />
                  {error && <p className="text-sm text-red-500">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading || !email}
                    className="w-full bg-[#0071e3] text-white font-medium text-sm py-3 rounded-full hover:bg-[#0077ED] transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                  >
                    {loading ? "Отправка..." : "Войти"}
                  </button>
                  <p className="text-center text-xs text-[#86868b] font-[family-name:var(--font-inter)]">
                    Если аккаунта нет — пришлём ссылку для входа
                  </p>
                </form>
              )}

              {emailSubView === "magic-link-sent" && (
                <div className="space-y-3 text-center py-2">
                  <div className="flex justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0071e3]/10">
                      <MailIcon />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1d1d1f] font-[family-name:var(--font-inter)]">
                      Проверьте почту
                    </p>
                    <p className="text-sm text-[#86868b] mt-1 font-[family-name:var(--font-inter)]">
                      Отправили письмо на{" "}
                      <span className="text-[#1d1d1f] font-medium">{email}</span>
                    </p>
                    <p className="text-xs text-[#86868b]/70 mt-1 font-[family-name:var(--font-inter)]">
                      Ссылка действительна 15 минут
                    </p>
                  </div>
                  <button
                    onClick={() => { setEmailSubView("form"); setError(""); }}
                    className="text-sm text-[#0071e3] hover:text-[#0077ED] font-[family-name:var(--font-inter)]"
                  >
                    Изменить email или отправить повторно
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// --- Icons ---

function MailIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 7 10-7" />
    </svg>
  );
}


