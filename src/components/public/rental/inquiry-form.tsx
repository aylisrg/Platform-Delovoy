"use client";

import { useState, useCallback, useRef } from "react";
import { reachGoal } from "@/lib/metrika";

type Office = {
  id: string;
  number: string;
  floor: number;
  status: string;
};

type InquiryFormProps = {
  offices: Office[];
  selectedOfficeIds?: string[];
  onToggleOffice?: (id: string) => void;
  onFormReset?: () => void;
};

export function InquiryForm({
  offices,
  selectedOfficeIds = [],
  onToggleOffice,
  onFormReset,
}: InquiryFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const startTrackedRef = useRef(false);

  // Помечаем начало воронки при первом взаимодействии — раньше цель `office_inquiry_start`
  // была мёртвой (declared but never reached). См. analytics gap report.
  const handleFieldFocus = useCallback(() => {
    if (startTrackedRef.current) return;
    startTrackedRef.current = true;
    reachGoal("office_inquiry_start");
  }, []);

  const availableOffices = offices.filter((o) => o.status === "AVAILABLE");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setResult(null);
      reachGoal("office_inquiry_submit");
      try {
        const res = await fetch("/api/rental/inquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            ...(email.trim() && { email: email.trim() }),
            ...(companyName.trim() && { companyName: companyName.trim() }),
            ...(message.trim() && { message: message.trim() }),
            ...(selectedOfficeIds.length > 0 && { officeIds: selectedOfficeIds }),
          }),
        });

        const data = await res.json();

        if (data.success) {
          reachGoal("office_inquiry_success");
          setResult({
            ok: true,
            message: "Мы получили вашу заявку, свяжемся с вами в рабочее время (Пн-Пт, 9:00–18:00).",
          });
          setName("");
          setPhone("");
          setEmail("");
          setCompanyName("");
          setMessage("");
          onFormReset?.();
        } else {
          setResult({ ok: false, message: data.error?.message || "Ошибка отправки" });
        }
      } catch {
        setResult({ ok: false, message: "Ошибка сети. Попробуйте позже." });
      } finally {
        setLoading(false);
      }
    },
    [name, phone, email, companyName, message, selectedOfficeIds, onFormReset]
  );

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-6">
      <h2 className="text-lg font-semibold text-zinc-900 mb-1">
        Заинтересованы в аренде?
      </h2>
      <p className="text-sm text-zinc-600 mb-5">
        Оставьте заявку — менеджер свяжется с вами для обсуждения условий и осмотра офиса.
      </p>

      {result?.ok ? (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
          {result.message}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={handleFieldFocus}
              required
              placeholder="Ваше имя *"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onFocus={handleFieldFocus}
              required
              placeholder="Телефон *"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Название компании"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Multi-select offices */}
          {availableOffices.length > 0 && (
            <div>
              <p className="text-sm text-zinc-600 mb-2">
                Интересующие офисы{selectedOfficeIds.length > 0 && ` (${selectedOfficeIds.length})`}:
              </p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-300 bg-white p-2 space-y-1">
                {availableOffices.map((o) => {
                  const checked = selectedOfficeIds.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm transition-colors ${
                        checked ? "bg-blue-50 text-blue-800" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleOffice?.(o.id)}
                        className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                      />
                      Офис №{o.number} ({o.floor} эт.)
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Комментарий (необязательно)"
            rows={3}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />

          {result && !result.ok && (
            <p className="text-sm text-red-500">{result.message}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Отправка..." : "Отправить заявку"}
          </button>
        </form>
      )}
    </div>
  );
}
