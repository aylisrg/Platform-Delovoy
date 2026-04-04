"use client";

import { useState } from "react";
import type { TimewebPowerAction } from "@/modules/timeweb/types";

const actions: {
  action: TimewebPowerAction;
  label: string;
  description: string;
  color: string;
  hoverColor: string;
}[] = [
  {
    action: "start",
    label: "Запустить",
    description: "Включить сервер",
    color: "bg-green-600",
    hoverColor: "hover:bg-green-700",
  },
  {
    action: "reboot",
    label: "Перезагрузить",
    description: "Мягкая перезагрузка",
    color: "bg-blue-600",
    hoverColor: "hover:bg-blue-700",
  },
  {
    action: "shutdown",
    label: "Выключить",
    description: "Мягкое выключение",
    color: "bg-orange-600",
    hoverColor: "hover:bg-orange-700",
  },
  {
    action: "hard-reboot",
    label: "Жёсткая перезагрузка",
    description: "Принудительная перезагрузка",
    color: "bg-red-600",
    hoverColor: "hover:bg-red-700",
  },
];

export function PowerControls() {
  const [confirming, setConfirming] = useState<TimewebPowerAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function handleAction(action: TimewebPowerAction) {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/timeweb/power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const body = await res.json();

      if (body.success) {
        setResult({
          type: "success",
          message: `Действие "${action}" выполнено`,
        });
      } else {
        setResult({
          type: "error",
          message: body.error?.message ?? "Ошибка выполнения",
        });
      }
    } catch {
      setResult({ type: "error", message: "Ошибка сети" });
    } finally {
      setLoading(false);
      setConfirming(null);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">
        Управление питанием
      </h3>

      {result && (
        <div
          className={`mb-4 rounded-lg p-3 text-sm ${
            result.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {actions.map((a) => (
          <div key={a.action}>
            {confirming === a.action ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-600">{a.description}?</span>
                <button
                  onClick={() => handleAction(a.action)}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? "..." : "Да"}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={loading}
                  className="rounded-lg bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-300 disabled:opacity-50"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(a.action)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${a.color} ${a.hoverColor}`}
              >
                {a.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
