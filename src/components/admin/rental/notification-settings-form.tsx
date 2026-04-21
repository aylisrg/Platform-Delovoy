"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type FormState = {
  preReminderDays: number;
  escalationDaysAfter: number;
  autoSendEnabled: boolean;
  fromEmail: string;
  fromName: string;
  bankDetails: string;
  managerName: string;
  managerPhone: string;
  escalationTelegramEnabled: boolean;
  escalationTelegramChatId: string;
};

export function RentalNotificationSettingsForm({ initial }: { initial: FormState }) {
  const [state, setState] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/rental/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preReminderDays: state.preReminderDays,
          escalationDaysAfter: state.escalationDaysAfter,
          autoSendEnabled: state.autoSendEnabled,
          fromEmail: state.fromEmail,
          fromName: state.fromName,
          bankDetails: state.bankDetails || null,
          managerName: state.managerName || null,
          managerPhone: state.managerPhone || null,
          escalationTelegramEnabled: state.escalationTelegramEnabled,
          escalationTelegramChatId: state.escalationTelegramChatId || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка сохранения");
      setMessage("Настройки сохранены");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={state.autoSendEnabled}
            onChange={(e) => update("autoSendEnabled", e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div>
            <p className="font-semibold text-zinc-900">Автоматические рассылки включены</p>
            <p className="text-sm text-zinc-500 mt-1">
              Отключите до завершения разметки платежей прошлых периодов, иначе
              арендаторы получат напоминания о давно оплаченных месяцах.
            </p>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="За сколько дней напоминать (T-N)">
          <input
            type="number"
            min={1}
            max={30}
            value={state.preReminderDays}
            onChange={(e) => update("preReminderDays", Number(e.target.value))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Через сколько дней просрочки эскалация (T+M)">
          <input
            type="number"
            min={1}
            max={30}
            value={state.escalationDaysAfter}
            onChange={(e) => update("escalationDaysAfter", Number(e.target.value))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Email отправителя (From)">
          <input
            type="email"
            value={state.fromEmail}
            onChange={(e) => update("fromEmail", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </Field>
        <Field label="Имя отправителя">
          <input
            type="text"
            value={state.fromName}
            onChange={(e) => update("fromName", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </Field>
      </div>

      <Field label="Банковские реквизиты (подставляются в шаблон как {{bankDetails}})">
        <textarea
          value={state.bankDetails}
          onChange={(e) => update("bankDetails", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-mono"
          placeholder="Р/с 40702…, БИК 044525…"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Имя менеджера (подпись {{managerName}})">
          <input
            type="text"
            value={state.managerName}
            onChange={(e) => update("managerName", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Телефон менеджера ({{managerPhone}})">
          <input
            type="text"
            value={state.managerPhone}
            onChange={(e) => update("managerPhone", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={state.escalationTelegramEnabled}
            onChange={(e) => update("escalationTelegramEnabled", e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-medium text-zinc-900">
            Отправлять Telegram-алерт менеджеру при просрочке T+{state.escalationDaysAfter} дней
          </span>
        </label>
        <Field label="ID Telegram-чата менеджера (пусто = общий TELEGRAM_ADMIN_CHAT_ID)">
          <input
            type="text"
            value={state.escalationTelegramChatId}
            onChange={(e) => update("escalationTelegramChatId", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="-1001234567890"
          />
        </Field>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
