"use client";

import { useState } from "react";

interface PhoneActionsProps {
  phone: string;
  tenantId?: string;
  /** Optional display label (formatted). Falls back to raw phone. */
  displayPhone?: string;
}

type CallState = "idle" | "loading" | "calling" | "failed";

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
 * Displays a call action button next to a phone number.
 * Renders the phone as a tel: link, then a click-to-call button.
 *
 * SMS is intentionally not implemented: Novofon (после ребренда из Zadarma)
 * не предоставляет API исходящих SMS.
 */
export function PhoneActions({ phone, tenantId, displayPhone }: PhoneActionsProps) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

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

  const label = displayPhone ?? phone;

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <a href={`tel:+${phone}`} className="text-blue-600 hover:underline text-sm">
        {label}
      </a>

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
