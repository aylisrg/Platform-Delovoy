"use client";

import { useState } from "react";
import { playSessionEndingAlert } from "@/lib/sound";

export function TestAlertsButton() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function handleTest() {
    setStatus("sending");

    // 1. Sound in browser
    playSessionEndingAlert();

    // 2. Telegram alert
    try {
      const res = await fetch("/api/ps-park/session-ending-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: "test",
          resourceName: "Тестовый стол",
          clientName: "Тест уведомлений",
          remainingMinutes: 10,
        }),
      });
      const data = await res.json();
      setStatus(data.success ? "done" : "error");
    } catch {
      setStatus("error");
    }

    setTimeout(() => setStatus("idle"), 3000);
  }

  return (
    <button
      onClick={handleTest}
      disabled={status === "sending"}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        status === "done"
          ? "bg-emerald-100 text-emerald-700"
          : status === "error"
          ? "bg-red-100 text-red-700"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {status === "sending" && "Отправка..."}
      {status === "done" && "Отправлено!"}
      {status === "error" && "Ошибка ТГ"}
      {status === "idle" && (
        <>
          <span>🔔</span>
          Тест уведомлений
        </>
      )}
    </button>
  );
}
