"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiFetchError, useTelegram } from "@/components/webapp/TelegramProvider";

/**
 * Привязка Telegram к аккаунту на сайте по коду из письма (PRD 2026-10-25
 * US-E3/US-E4, ADR §7 «Mini App: привязка»). Только email: SMS-доставки нет
 * (AC-E3.6). Ответ на запрос кода всегда один и тот же (AC-E3.3); 503/502 —
 * «Не удалось отправить код…» (AC-E3.5); 409 — запрос на объединение ушёл
 * администратору (AC-E4.1).
 */

type Step = "input" | "code" | "done" | "conflict";

const LINK_ACCOUNT_TEXTS = {
  sendFailed: "Не удалось отправить код. Попробуйте позже или обратитесь к администратору.",
  conflict:
    "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом.",
  generic: "Если такой аккаунт есть, мы отправили код на его email.",
} as const;

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiFetchError) {
    if (e.status === 503 || e.status === 502) return LINK_ACCOUNT_TEXTS.sendFailed;
    return e.message || fallback;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function LinkAccountPage() {
  const router = useRouter();
  const { apiFetch, setNeedsLinking, setUser, setToken, haptic } = useTelegram();

  const [step, setStep] = useState<Step>("input");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [maskedValue, setMaskedValue] = useState("");
  const [message, setMessage] = useState<string>(LINK_ACCOUNT_TEXTS.generic);
  const [merged, setMerged] = useState(false);
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

  function leave() {
    haptic.impact("light");
    setNeedsLinking(false);
    router.replace("/webapp");
  }

  async function handleRequestOtp() {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ sent: boolean; maskedValue: string; message?: string }>(
        "/api/webapp/link/request",
        { method: "POST", body: JSON.stringify({ type: "email", value: value.trim() }) },
      );
      setMaskedValue(result.maskedValue);
      setMessage(result.message || LINK_ACCOUNT_TEXTS.generic);
      haptic.notification("success");
      setStep("code");
    } catch (e: unknown) {
      haptic.notification("error");
      setError(errorText(e, "Ошибка. Попробуйте ещё раз."));
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
        merged?: boolean;
        user: { id: string; name: string | null; role: string; telegramId: string };
        token: string;
      }>("/api/webapp/link/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setUser({ ...result.user, image: null });
      setToken(result.token);
      setNeedsLinking(false);
      setMerged(result.merged === true);
      haptic.notification("success");
      setStep("done");
    } catch (e: unknown) {
      if (e instanceof ApiFetchError && e.code === "TELEGRAM_IN_USE_MERGE_REQUESTED") {
        haptic.notification("warning");
        setStep("conflict");
        return;
      }
      haptic.notification("error");
      setError(errorText(e, "Неверный код"));
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
          {merged
            ? "Аккаунт из Telegram объединён с вашим — брони, заказы и настройки теперь в одном месте."
            : "Ваша история бронирований и настройки теперь доступны в Telegram."}
        </p>
        <button className="tg-button mt-8" onClick={() => { haptic.impact("light"); router.replace("/webapp"); }}>
          Перейти в приложение
        </button>
      </div>
    );
  }

  if (step === "conflict") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <div className="text-6xl mb-4">🤝</div>
        <h1 className="text-[22px] font-bold">Запрос передан администратору</h1>
        <p className="mt-2 text-[15px]" style={{ color: "var(--tg-hint)" }} role="status">
          {LINK_ACCOUNT_TEXTS.conflict}
        </p>
        <button className="tg-button mt-8" onClick={leave}>
          Продолжить
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
          Привяжите Telegram по коду из письма, чтобы видеть свои бронирования и заказы
        </p>
      </div>

      {step === "input" && (
        <div className="space-y-4">
          <div>
            <p className="text-[14px] mb-2" style={{ color: "var(--tg-hint)" }}>
              Введите email от вашего аккаунта
            </p>
            <input
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="example@mail.ru"
              autoFocus
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-[16px] focus:outline-none focus:border-blue-500"
              style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)" }}
              onKeyDown={(e) => e.key === "Enter" && handleRequestOtp()}
            />
          </div>
          {error && <p role="alert" className="text-[13px] text-red-500">{error}</p>}
          <button className="tg-button" onClick={handleRequestOtp} disabled={loading || !value.trim()}>
            {loading ? "Отправка..." : "Получить код"}
          </button>
          <button
            className="mt-2 w-full py-3 text-[15px] font-medium"
            style={{ color: "var(--tg-hint)" }}
            onClick={handleSkip}
          >
            Пропустить
          </button>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-4">
          <div>
            <p className="text-[14px] mb-2" style={{ color: "var(--tg-hint)" }} data-testid="otp-sent-note">
              {message.replace(/\.$/, "")}
              {maskedValue ? ` (${maskedValue})` : ""}. Код действует 10 минут.
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
          {error && <p role="alert" className="text-[13px] text-red-500 text-center">{error}</p>}
          <button className="tg-button" onClick={handleConfirmOtp} disabled={loading || code.length !== 6}>
            {loading ? "Проверка..." : "Подтвердить"}
          </button>
          <button
            className="w-full py-3 text-[15px]"
            style={{ color: "var(--tg-hint)" }}
            onClick={() => { setStep("input"); setCode(""); setError(null); }}
          >
            Запросить код повторно
          </button>
          <button className="w-full py-3 text-[15px]" style={{ color: "var(--tg-hint)" }} onClick={handleSkip}>
            Пропустить
          </button>
        </div>
      )}
    </div>
  );
}
