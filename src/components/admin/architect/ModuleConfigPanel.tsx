"use client";

import { useState } from "react";
import { ConfigEditor } from "./ConfigEditor";
import { Badge } from "@/components/ui/badge";

type Props = {
  moduleId: string;
  slug: string;
  name: string;
  isActive: boolean;
  config: Record<string, unknown>;
};

export function ModuleConfigPanel({ moduleId, slug, name, isActive, config }: Props) {
  const [active, setActive] = useState(isActive);
  const [currentConfig, setCurrentConfig] = useState<Record<string, unknown>>(config);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function toggleActive() {
    setToggling(true);
    setMessage(null);
    const next = !active;
    try {
      const res = await fetch(`/api/architect/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error("Ошибка сервера");
      setActive(next);
      setMessage({
        type: "success",
        text: next ? "Модуль включён" : "Модуль отключён",
      });
    } catch {
      setMessage({ type: "error", text: "Не удалось обновить статус модуля" });
    } finally {
      setToggling(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/architect/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: currentConfig }),
      });
      if (!res.ok) throw new Error("Ошибка сервера");
      setMessage({ type: "success", text: "Конфигурация сохранена" });
    } catch {
      setMessage({ type: "error", text: "Не удалось сохранить конфигурацию" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status toggle */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-6 py-4 shadow-sm">
        <div>
          <p className="font-semibold text-zinc-900">{name}</p>
          <p className="text-sm text-zinc-400 font-mono">{slug}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={active ? "success" : "default"}>
            {active ? "Активен" : "Отключён"}
          </Badge>
          <button
            onClick={toggleActive}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 ${
              active ? "bg-blue-600" : "bg-zinc-300"
            } ${toggling ? "opacity-50 cursor-not-allowed" : ""}`}
            aria-label={active ? "Отключить модуль" : "Включить модуль"}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                active ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Config editor */}
      <div className="rounded-xl border border-zinc-200 bg-white px-6 py-4 shadow-sm">
        <h3 className="font-semibold text-zinc-900 mb-4">Параметры конфигурации</h3>
        <ConfigEditor config={currentConfig} onChange={setCurrentConfig} />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Сохранение..." : "Сохранить конфиг"}
          </button>
          {message && (
            <span
              className={`text-sm ${message.type === "success" ? "text-green-600" : "text-red-600"}`}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
