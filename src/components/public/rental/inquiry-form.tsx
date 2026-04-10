"use client";

import { useState, useCallback } from "react";

type Office = {
  id: string;
  number: string;
  floor: number;
  status: string;
};

export function InquiryForm({ offices }: { offices: Office[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [message, setMessage] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const availableOffices = offices.filter((o) => o.status === "AVAILABLE");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setResult(null);

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
            ...(officeId && { officeId }),
          }),
        });

        const data = await res.json();

        if (data.success) {
          setResult({ ok: true, message: "Заявка отправлена! Мы свяжемся с вами в ближайшее время." });
          setName("");
          setPhone("");
          setEmail("");
          setCompanyName("");
          setMessage("");
          setOfficeId("");
        } else {
          setResult({ ok: false, message: data.error?.message || "Ошибка отправки" });
        }
      } catch {
        setResult({ ok: false, message: "Ошибка сети. Попробуйте позже." });
      } finally {
        setLoading(false);
      }
    },
    [name, phone, email, companyName, message, officeId]
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
              required
              placeholder="Ваше имя *"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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

          {availableOffices.length > 0 && (
            <select
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Интересующий офис (необязательно)</option>
              {availableOffices.map((o) => (
                <option key={o.id} value={o.id}>
                  Офис №{o.number} ({o.floor} эт.)
                </option>
              ))}
            </select>
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
