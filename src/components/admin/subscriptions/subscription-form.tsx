"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  defaultUserId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function SubscriptionForm({ defaultUserId, onSuccess, onCancel }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  const [userId, setUserId] = useState(defaultUserId ?? "");
  const [totalHours, setTotalHours] = useState("10");
  const [pricePaid, setPricePaid] = useState("5000");
  const [paymentMethod, setPaymentMethod] = useState<"manual" | "online">("manual");
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [validTo, setValidTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setExistingId(null);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          totalHours: Number(totalHours),
          pricePaid: Number(pricePaid),
          validFrom,
          validTo,
          notes: notes.trim() || null,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Онлайн-оплата: показываем ссылку — её нужно отправить гостю.
        // Пасс активируется автоматически после оплаты.
        if (data.data?.payment?.confirmationUrl) {
          setPaymentLink(data.data.payment.confirmationUrl);
          router.refresh();
          return;
        }
        if (onSuccess) onSuccess();
        else router.push(`/admin/ps-park/subscriptions/${data.data.id}`);
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка создания");
        if (data.error?.metadata?.existingSubscriptionId) {
          setExistingId(data.error.metadata.existingSubscriptionId as string);
        }
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">Создать абонемент</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-zinc-600">
          ID гостя
          <input
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="user-..."
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-zinc-600">
          Часов (шаг 0.25)
          <input
            required
            type="number"
            step={0.25}
            min={0.25}
            value={totalHours}
            onChange={(e) => setTotalHours(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums"
          />
        </label>

        <label className="text-xs font-medium text-zinc-600">
          Цена (₽)
          <input
            required
            type="number"
            step={1}
            min={0}
            value={pricePaid}
            onChange={(e) => setPricePaid(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums"
          />
        </label>

        <label className="text-xs font-medium text-zinc-600">
          Действует с
          <input
            required
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-zinc-600 col-span-2">
          Действует до
          <input
            required
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-zinc-600 col-span-2">
          Оплата
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as "manual" | "online")}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="manual">На месте (наличные/карта) — активен сразу</option>
            <option value="online">Онлайн-ссылка (ЮKassa) — активация после оплаты</option>
          </select>
        </label>

        <label className="text-xs font-medium text-zinc-600 col-span-2">
          Заметки
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {paymentLink && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <div className="font-medium">Абонемент создан, ждёт оплаты.</div>
          <div className="mt-1 break-all text-xs">{paymentLink}</div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(paymentLink)}
            className="mt-2 rounded-lg border border-emerald-300 px-3 py-1 text-xs hover:bg-emerald-100"
          >
            Скопировать ссылку для гостя
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
          {existingId && (
            <a
              href={`/admin/ps-park/subscriptions/${existingId}`}
              className="ml-2 underline"
            >
              Перейти к существующему
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? "Создание..." : "Создать абонемент"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}
