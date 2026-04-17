"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";

type Step = "choice" | "input" | "code" | "done";
type LinkType = "email" | "phone";

export default function LinkAccountPage() {
  const router = useRouter();
  const { apiFetch, setNeedsLinking, setUser, setToken, haptic } = useTelegram();

  const [step, setStep] = useState<Step>("choice");
  const [linkType, setLinkType] = useState<LinkType>("email");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [maskedValue, setMaskedValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSkip() {
    haptic.impact("light");
    try {
      await apiFetch("/api/webapp/link/skip", { method: "POST" });
    } catch { /* ignore */ }
    setNeedsLinking(false);
    router.replace("/webapp");
  }

  async function handleRequestOtp() {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ sent: boolean; maskedValue: string }>("/api/webapp/link/request", {
        method: "POST",
        body: JSON.stringify({ type: linkType, value: value.trim() }),
      });
      setMaskedValue(result.maskedValue);
      haptic.notification("success");
      setStep("code");
    } catch (e: unknown) {
      haptic.notification("error");
      setError(e instanceof Error ? e.message : "Ошибка. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOtp() {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        linked: boolean;
        user: { id: string; name: string | null; role: string; telegramId: string };
        token: string;
      }>("/api/webapp/link/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setUser({ ...result.user, image: null });
      setToken(result.token);
      setNeedsLinking(false);
      haptic.notification("success");
      setStep("done");
    } catch (e: unknown) {
      haptic.notification("error");
      setError(e instanceof Error ? e.message : "Неверный код");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-[22px] font-bold">Аккаунт привязан!</h1>
        <p className="mt-2 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Ваша история бронирований и настройки теперь доступны в Telegram.
        </p>
        <button
          className="tg-button mt-8"
          onClick={() => { haptic.impact("light"); router.replace("/webapp"); }}
        >
          Перейти в приложение
        </button>
      </div>
    );
  }

  return (
    <div className="tg-page-enter px-4 pt-8 pb-6">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-[22px] font-bold">У вас есть аккаунт на сайте?</h1>
        <p className="mt-2 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Привяжите Telegram, чтобы видеть свои бронирования и заказы
        </p>
      </div>

      {step === "choice" && (
        <div className="space-y-3">
          <button
            className="tg-button"
            onClick={() => { haptic.impact("light"); setLinkType("email"); setStep("input"); }}
          >
            Привязать по Email
          </button>
          <button
            className="tg-button"
            style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
            onClick={() => { haptic.impact("light"); setLinkType("phone"); setStep("input"); }}
          >
            Привязать по номеру телефона
          </button>
          <button
            className="mt-4 w-full py-3 text-[15px] font-medium"
            style={{ color: "var(--tg-hint)" }}
            onClick={handleSkip}
          >
            Пропустить
          </button>
        </div>
      )}

      {step === "input" && (
        <div className="space-y-4">
          <div>
            <p className="text-[14px] mb-2" style={{ color: "var(--tg-hint)" }}>
              {linkType === "email" ? "Введите email от вашего аккаунта" : "Введите номер телефона"}
            </p>
            <input
              type={linkType === "email" ? "email" : "tel"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={linkType === "email" ? "example@mail.ru" : "+7 900 000 00 00"}
              autoFocus
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-[16px] focus:outline-none focus:border-blue-500"
              style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
              onKeyDown={(e) => e.key === "Enter" && handleRequestOtp()}
            />
          </div>
          {error && (
            <p className="text-[13px] text-red-500">{error}</p>
          )}
          <button
            className="tg-button"
            onClick={handleRequestOtp}
            disabled={loading || !value.trim()}
          >
            {loading ? "Отправка..." : "Получить код"}
          </button>
          <button
            className="w-full py-3 text-[15px]"
            style={{ color: "var(--tg-hint)" }}
            onClick={() => { setStep("choice"); setError(null); }}
          >
            Назад
          </button>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-4">
          <div>
            <p className="text-[14px] mb-2" style={{ color: "var(--tg-hint)" }}>
              Код отправлен на {maskedValue}
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              autoFocus
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-[24px] tracking-[0.3em] text-center font-mono focus:outline-none focus:border-blue-500"
              style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && handleConfirmOtp()}
            />
          </div>
          {error && (
            <p className="text-[13px] text-red-500 text-center">{error}</p>
          )}
          <button
            className="tg-button"
            onClick={handleConfirmOtp}
            disabled={loading || code.length !== 6}
          >
            {loading ? "Проверка..." : "Подтвердить"}
          </button>
          <button
            className="w-full py-3 text-[15px]"
            style={{ color: "var(--tg-hint)" }}
            onClick={() => { setStep("input"); setCode(""); setError(null); }}
          >
            Запросить код повторно
          </button>
          <button
            className="w-full py-3 text-[15px]"
            style={{ color: "var(--tg-hint)" }}
            onClick={handleSkip}
          >
            Пропустить
          </button>
        </div>
      )}
    </div>
  );
}
