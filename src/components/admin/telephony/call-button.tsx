"use client";

import { useState } from "react";

interface CallButtonProps {
  bookingId: string;
  moduleSlug: "gazebos" | "ps-park";
  clientPhone: string;
}

type CallState = "idle" | "loading" | "calling" | "failed";

const statusLabels: Record<string, string> = {
  INITIATED: "Инициирован",
  RINGING: "Звонок...",
  ANSWERED: "Отвечен",
  COMPLETED: "Завершён",
  NO_ANSWER: "Нет ответа",
  BUSY: "Занято",
  FAILED: "Ошибка",
};

export function CallButton({ bookingId, moduleSlug, clientPhone }: CallButtonProps) {
  const [state, setCallState] = useState<CallState>("idle");
  const [callStatus, setCallStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCall() {
    setCallState("loading");
    setError(null);

    try {
      const res = await fetch("/api/telephony/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, moduleSlug }),
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
        setError(data.error?.message ?? "Ошибка при инициации звонка");
      }
    } catch {
      setCallState("failed");
      setError("Сетевая ошибка");
    }
  }

  function reset() {
    setCallState("idle");
    setCallStatus(null);
    setError(null);
  }

  if (state === "calling" && callStatus) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {statusLabels[callStatus] ?? callStatus}
        </span>
        <button
          onClick={reset}
          className="text-zinc-400 hover:text-zinc-600 transition-colors"
          title="Закрыть"
        >
          ✕
        </button>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-red-500">{error}</span>
        <button
          onClick={reset}
          className="text-zinc-400 hover:text-zinc-600 transition-colors text-xs"
        >
          повторить
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleCall}
      disabled={state === "loading"}
      title={`Позвонить: ${clientPhone}`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors"
    >
      {state === "loading" ? (
        <>
          <span className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
          Звоним…
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
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
          Позвонить
        </>
      )}
    </button>
  );
}
