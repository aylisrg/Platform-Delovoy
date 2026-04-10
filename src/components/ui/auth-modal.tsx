"use client";

import { signIn } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";

type AuthTab = "telegram" | "other" | "email" | "whatsapp";
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
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
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

  const handleSendOtp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);
      try {
        const res = await fetch("/api/auth/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();
        if (data.success) {
          setOtpSent(true);
        } else {
          setError(data.error?.message || "Ошибка отправки кода");
        }
      } catch {
        setError("Ошибка сети");
      } finally {
        setLoading(false);
      }
    },
    [phone]
  );

  const handleVerifyOtp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);
      try {
        const verifyRes = await fetch("/api/auth/whatsapp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code: otpCode }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          setError(verifyData.error?.message || "Неверный код");
          setLoading(false);
          return;
        }
        const result = await signIn("whatsapp", {
          userId: verifyData.data.userId,
          redirect: false,
        });
        if (result?.error || !result?.ok) {
          setError("Ошибка входа");
          setLoading(false);
        } else {
          onClose();
          window.location.reload();
        }
      } catch {
        setError("Ошибка сети");
        setLoading(false);
      }
    },
    [phone, otpCode, onClose]
  );

  const handleOAuth = useCallback(async (provider: string) => {
    setError("");
    setLoading(true);
    await signIn(provider, { callbackUrl: window.location.href });
  }, []);

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
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.04] hover:bg-black/[0.08] text-[#86868b] hover:text-[#1d1d1f] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-8 pt-8 pb-2 text-center">
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
        <div className="px-8 pb-8 pt-4">

          {/* Telegram — primary method, always visible */}
          {tab === "telegram" && (
            <div className="space-y-4">
              {/* Telegram Login Widget */}
              <TelegramLoginInModal />

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-black/[0.06]" />
                <span className="text-xs text-[#86868b] font-[family-name:var(--font-inter)]">или</span>
                <div className="flex-1 h-px bg-black/[0.06]" />
              </div>

              {/* Other methods */}
              <div className="space-y-2">
                <OAuthButton onClick={() => handleOAuth("google")} disabled={loading} icon={<GoogleIcon />} label="Google" />
                <OAuthButton onClick={() => handleOAuth("yandex")} disabled={loading} icon={<YandexIcon />} label="Яндекс" />
                <OAuthButton onClick={() => handleOAuth("vk")} disabled={loading} icon={<VKIcon />} label="VK" />
              </div>

              {/* Secondary auth links */}
              <div className="flex justify-center gap-4 pt-1">
                <button
                  onClick={() => { setTab("whatsapp"); setError(""); }}
                  className="text-xs text-[#86868b] hover:text-[#1d1d1f] transition-colors font-[family-name:var(--font-inter)]"
                >
                  WhatsApp
                </button>
                <span className="text-[#86868b]/30">|</span>
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

          {/* WhatsApp */}
          {tab === "whatsapp" && !otpSent && (
            <div className="space-y-3">
              <button
                onClick={() => { setTab("telegram"); setError(""); }}
                className="text-sm text-[#0071e3] hover:text-[#0077ED] font-[family-name:var(--font-inter)] mb-1"
              >
                ← Назад
              </button>
              <form onSubmit={handleSendOtp} className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 px-4 py-2.5">
                  <WhatsAppIcon />
                  <span className="text-sm text-[#25D366] font-[family-name:var(--font-inter)]">
                    Код придёт в WhatsApp
                  </span>
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="+7 999 123-45-67"
                  className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm font-[family-name:var(--font-inter)] placeholder-[#86868b]/50 focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/20"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#25D366] text-white font-medium text-sm py-3 rounded-full hover:bg-[#20BD5A] transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {loading ? "Отправка..." : "Получить код"}
                </button>
              </form>
            </div>
          )}

          {tab === "whatsapp" && otpSent && (
            <div className="space-y-3">
              <button
                onClick={() => { setTab("telegram"); setError(""); }}
                className="text-sm text-[#0071e3] hover:text-[#0077ED] font-[family-name:var(--font-inter)] mb-1"
              >
                ← Назад
              </button>
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 px-4 py-2.5">
                  <WhatsAppIcon />
                  <span className="text-sm text-[#25D366] font-[family-name:var(--font-inter)]">
                    Код отправлен
                  </span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  placeholder="Код из WhatsApp"
                  className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[#1d1d1f] text-sm text-center tracking-[0.3em] font-mono font-[family-name:var(--font-inter)] placeholder-[#86868b]/50 focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366]/20"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="w-full bg-[#25D366] text-white font-medium text-sm py-3 rounded-full hover:bg-[#20BD5A] transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
                >
                  {loading ? "Проверка..." : "Войти"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                    setError("");
                  }}
                  className="w-full text-center text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors font-[family-name:var(--font-inter)]"
                >
                  Отправить код повторно
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function OAuthButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-black/[0.08] bg-white px-4 py-3 text-sm font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] disabled:opacity-50 font-[family-name:var(--font-inter)]"
    >
      {icon}
      Войти через {label}
    </button>
  );
}

function TelegramLoginInModal() {
  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME;

  useEffect(() => {
    if (!botName) return;

    (window as unknown as Record<string, unknown>).onTelegramAuth = async (
      user: Record<string, string>
    ) => {
      await signIn("telegram", {
        ...user,
        redirect: true,
        callbackUrl: window.location.href,
      });
    };

    const container = document.getElementById("telegram-login-modal");
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
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
      <div className="flex items-center justify-center gap-2 rounded-xl bg-[#26A5E4]/10 border border-[#26A5E4]/20 px-4 py-4">
        <TelegramIcon />
        <span className="text-sm text-[#26A5E4] font-medium font-[family-name:var(--font-inter)]">
          Telegram вход скоро будет доступен
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-[#26A5E4] mb-1">
        <TelegramIcon />
        <span className="text-sm font-medium font-[family-name:var(--font-inter)]">
          Быстрый вход через Telegram
        </span>
      </div>
      <div id="telegram-login-modal" className="flex justify-center" />
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

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#26A5E4" />
      <path d="M17.05 7.26l-1.83 9.43c-.14.62-.5.77-.99.48l-2.78-2.05-1.34 1.29c-.15.15-.27.27-.56.27l.2-2.83 5.15-4.65c.22-.2-.05-.31-.35-.12l-6.36 4.01-2.74-.85c-.59-.19-.61-.59.12-.88l10.72-4.13c.5-.19.94.12.76.88z" fill="white" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function YandexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#FC3F1D" />
      <path d="M13.63 19.2h2.05V4.8h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38l-3.06 6h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V19.2z" fill="white" />
    </svg>
  );
}

function VKIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0077FF" />
      <path d="M12.77 16.87h.89s.27-.03.4-.18c.13-.14.12-.4.12-.4s-.02-1.22.55-1.4c.56-.18 1.28 1.18 2.04 1.7.58.39 1.02.3 1.02.3l2.05-.03s1.07-.07.56-.91c-.04-.07-.3-.63-1.55-1.78-1.31-1.2-1.13-.99.44-3.04.96-1.25 1.34-2.01 1.22-2.34-.12-.31-.83-.23-.83-.23l-2.31.01s-.17-.02-.3.05c-.12.08-.2.25-.2.25s-.37.98-.86 1.81c-1.03 1.74-1.45 1.83-1.62 1.72-.39-.26-.3-1.02-.3-1.57 0-1.7.26-2.41-.5-2.6-.25-.06-.44-.1-1.08-.11-.83-.01-1.53 0-1.93.2-.26.13-.47.42-.34.44.15.02.5.1.69.34.24.32.23 1.03.23 1.03s.14 2-.32 2.25c-.32.17-.75-.18-1.68-1.76-.48-.81-.84-1.7-.84-1.7s-.07-.17-.2-.26c-.15-.1-.36-.14-.36-.14l-2.2.01s-.33.01-.45.15c-.11.13-.01.4-.01.4s1.74 4.07 3.7 6.12c1.8 1.88 3.85 1.76 3.85 1.76z" fill="white" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#25D366" />
      <path d="M17.47 14.38c-.29-.15-1.73-.85-2-.95-.27-.1-.46-.15-.66.15-.2.29-.76.95-.93 1.14-.17.2-.34.22-.64.07-.29-.15-1.24-.46-2.37-1.46-.88-.78-1.47-1.74-1.64-2.04-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.2-.29.29-.49.1-.2.05-.37-.02-.51-.07-.15-.66-1.58-.9-2.17-.24-.57-.48-.49-.66-.5h-.56c-.2 0-.51.07-.78.37s-1.02 1-1.02 2.44c0 1.43 1.05 2.82 1.2 3.01.14.2 2.06 3.14 4.99 4.41.7.3 1.24.48 1.67.61.7.22 1.34.19 1.84.12.56-.08 1.73-.71 1.97-1.39.25-.68.25-1.27.17-1.39-.07-.12-.27-.2-.56-.34z" fill="white" />
    </svg>
  );
}
