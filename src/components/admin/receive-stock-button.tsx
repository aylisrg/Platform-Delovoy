"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";

export function ReceiveStockButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const dateLabel = formatDateTime(new Date());

  function resetForm() {
    setName("");
    setQuantity("");
    setNote("");
    setResult(null);
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !quantity) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/inventory/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          quantity: parseInt(quantity, 10),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({
          ok: true,
          message: `Записано: «${name.trim()}» — ${quantity} шт.`,
        });
        resetForm();
      } else {
        setResult({ ok: false, message: data.error?.message ?? "Ошибка при записи" });
      }
    } catch {
      setResult({ ok: false, message: "Не удалось отправить запрос" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
        style={{ backgroundColor: "#16a34a", color: "#ffffff" }}
      >
        <span>📦</span>
        Приехал новый товар
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleClose}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-zinc-900">
                Приход товара
              </h2>
              <button
                onClick={handleClose}
                className="text-zinc-400 hover:text-zinc-600 transition-colors text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Date label */}
            <div className="mb-4 flex items-center gap-2 text-xs text-zinc-400">
              <span>🗓</span>
              <span>Дата записи: <span className="font-medium text-zinc-600">{dateLabel}</span></span>
            </div>

            {result && (
              <div
                className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${
                  result.ok
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {result.message}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label htmlFor="receive-name" className="block text-sm font-medium text-zinc-700 mb-1">
                  Название товара *
                </label>
                <input
                  id="receive-name"
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Coca-Cola 0.5л, Пепперони, Наушники..."
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-zinc-400">
                  Если товар уже есть в системе — остаток будет обновлён
                </p>
              </div>

              {/* Quantity */}
              <div>
                <label htmlFor="receive-qty" className="block text-sm font-medium text-zinc-700 mb-1">
                  Количество (шт) *
                </label>
                <input
                  id="receive-qty"
                  type="number"
                  required
                  min="1"
                  max="9999"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="24"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Note */}
              <div>
                <label htmlFor="receive-note" className="block text-sm font-medium text-zinc-700 mb-1">
                  Примечание <span className="font-normal text-zinc-400">(необязательно)</span>
                </label>
                <input
                  id="receive-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Накладная №..., поставщик..."
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim() || !quantity}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: submitting ? "#4ade80" : "#16a34a" }}
                >
                  {submitting ? "Сохранение..." : "Записать приход"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
