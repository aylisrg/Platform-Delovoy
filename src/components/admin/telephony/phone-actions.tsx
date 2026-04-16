"use client";

import { useState } from "react";

interface PhoneActionsProps {
  phone: string;
  tenantId?: string;
  /** Optional display label (formatted). Falls back to raw phone. */
  displayPhone?: string;
}

type CallState = "idle" | "loading" | "calling" | "failed";
type SmsState = "idle" | "composing" | "sending" | "sent" | "failed";

const callStatusLabels: Record<string, string> = {
  INITIATED: "Инициирован",
  RINGING: "Звонок...",
  ANSWERED: "Отвечен",
  COMPLETED: "Завершён",
  NO_ANSWER: "Нет ответа",
  BUSY: "Занято",
  FAILED: "Ошибка",
};

/**
 * Displays call + SMS action buttons next to a phone number.
 * Renders the phone as a tel: link, then small icon buttons for call and SMS.
 */
export function PhoneActions({ phone, tenantId, displayPhone }: PhoneActionsProps) {
  // --- Call state ---
  const [callState, setCallState] = useState<CallState>("idle");
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  // --- SMS state ---
  const [smsState, setSmsState] = useState<SmsState>("idle");
  const [smsText, setSmsText] = useState("");
  const [smsError, setSmsError] = useState<string | null>(null);

  // --- Call handlers ---
  async function handleCall() {
    setCallState("loading");
    setCallError(null);
    try {
      const res = await fetch("/api/telephony/call-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, tenantId }),
      });
      const data = (await res.json()) as {
        success: boolean;
        data?: { status: string };
        error?: { message: string };
      };
      if (data.success && data.data) {
        setCallState("calling");
        setCallStatus(data.data.status);
      } else {
        setCallState("failed");
        setCallError(data.error?.message ?? "Ошибка при инициации звонка");
      }
    } catch {
      setCallState("failed");
      setCallError("Сетевая ошибка");
    }
  }

  function resetCall() {
    setCallState("idle");
    setCallStatus(null);
    setCallError(null);
  }

  // --- SMS handlers ---
  function openSms() {
    setSmsState("composing");
    setSmsText("");
    setSmsError(null);
  }

  function closeSms() {
    setSmsState("idle");
    setSmsText("");
    setSmsError(null);
  }

  async function handleSendSms() {
    if (!smsText.trim()) return;
    setSmsState("sending");
    setSmsError(null);
    try {
      const res = await fetch("/api/telephony/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: smsText.trim(), tenantId }),
      });
      const data = (await res.json()) as {
        success: boolean;
        error?: { message: string };
      };
      if (data.success) {
        setSmsState("sent");
        setTimeout(() => setSmsState("idle"), 2500);
      } else {
        setSmsState("failed");
        setSmsError(data.error?.message ?? "Ошибка при отправке SMS");
      }
    } catch {
      setSmsState("failed");
      setSmsError("Сетевая ошибка");
    }
  }

  const label = displayPhone ?? phone;

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {/* Phone as tel: link */}
      <a href={`tel:+${phone}`} className="text-blue-600 hover:underline text-sm">
        {label}
      </a>

      {/* Call button */}
      {callState === "idle" && (
        <button
          onClick={handleCall}
          title={`Позвонить: +${phone}`}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 hover:text-emerald-800 transition-colors px-1 py-0.5 rounded hover:bg-emerald-50"
        >
          <PhoneIcon />
          Позвонить
        </button>
      )}
      {callState === "loading" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
          <span className="w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
          Звоним…
        </span>
      )}
      {callState === "calling" && callStatus && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {callStatusLabels[callStatus] ?? callStatus}
          <button onClick={resetCall} className="text-zinc-400 hover:text-zinc-600 ml-0.5" title="Закрыть">
            ✕
          </button>
        </span>
      )}
      {callState === "failed" && (
        <span className="inline-flex items-center gap-1 text-[11px]">
          <span className="text-red-500">{callError}</span>
          <button onClick={resetCall} className="text-zinc-400 hover:text-zinc-600 text-[11px]">повторить</button>
        </span>
      )}

      {/* SMS button — disabled until Novofon SMS API method is confirmed */}
      <button
        disabled
        title="SMS отправка временно недоступна — уточняется API метод Novofon"
        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-300 cursor-not-allowed px-1 py-0.5 rounded"
      >
        <SmsIcon />
        SMS
      </button>

      {/* SMS compose modal (inline) */}
      {(smsState === "composing" || smsState === "sending" || smsState === "failed") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeSms(); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-zinc-900 text-sm">Отправить SMS</h3>
              <button onClick={closeSms} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">✕</button>
            </div>

            <p className="text-xs text-zinc-500 mb-3">
              Получатель: <span className="font-medium text-zinc-700">{label}</span>
            </p>

            <textarea
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="Введите текст SMS..."
              rows={4}
              maxLength={1000}
              autoFocus
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />

            <div className="flex items-center justify-between mt-1 mb-3">
              <span className="text-[10px] text-zinc-400">
                {smsText.length}/1000 симв.
                {smsText.length > 160 && (
                  <span className="ml-1 text-amber-500">
                    ({Math.ceil(smsText.length / 160)} части)
                  </span>
                )}
              </span>
              {smsError && (
                <span className="text-[11px] text-red-500">{smsError}</span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={closeSms}
                className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSendSms}
                disabled={!smsText.trim() || smsState === "sending"}
                className="flex-1 px-3 py-2 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {smsState === "sending" ? (
                  <span className="inline-flex items-center gap-1.5 justify-center">
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Отправляем…
                  </span>
                ) : (
                  "Отправить"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

function PhoneIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.69h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.29 6.29l.94-.94a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
