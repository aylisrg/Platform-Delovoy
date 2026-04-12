"use client";

import { useState, useEffect } from "react";

type SkuSummary = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  stockQuantity: number;
};

export function ReceiveStockButton() {
  const [open, setOpen] = useState(false);
  const [skus, setSkus] = useState<SkuSummary[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load SKU list when modal opens
  useEffect(() => {
    if (!open) return;
    setLoadingSkus(true);
    fetch("/api/inventory/sku")
      .then((r) => r.json())
      .then((d) => { if (d.success) setSkus(d.data); })
      .catch(() => {})
      .finally(() => setLoadingSkus(false));
  }, [open]);

  function resetForm() {
    setSkuId("");
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
    if (!skuId || !quantity) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/inventory/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          quantity: parseInt(quantity, 10),
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const sku = skus.find((s) => s.id === skuId);
        setResult({
          ok: true,
          message: `Добавлено ${quantity} ${sku?.unit ?? "шт"} — «${sku?.name ?? ""}»`,
        });
        resetForm();
        // Refresh SKUs to show updated stock
        fetch("/api/inventory/sku")
          .then((r) => r.json())
          .then((d) => { if (d.success) setSkus(d.data); })
          .catch(() => {});
      } else {
        setResult({ ok: false, message: data.error?.message ?? "Ошибка при добавлении" });
      }
    } catch {
      setResult({ ok: false, message: "Не удалось отправить запрос" });
    } finally {
      setSubmitting(false);
    }
  }

  const selectedSku = skus.find((s) => s.id === skuId);

  // Group by category for select
  const byCategory = skus.reduce<Record<string, SkuSummary[]>>((acc, sku) => {
    (acc[sku.category] ??= []).push(sku);
    return acc;
  }, {});

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
      >
        <span>📦</span>
        Приехал новый товар
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
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
              {/* SKU select */}
              <div>
                <label htmlFor="receive-sku" className="block text-sm font-medium text-zinc-700 mb-1">
                  Товар *
                </label>
                {loadingSkus ? (
                  <div className="h-10 rounded-lg bg-zinc-100 animate-pulse" />
                ) : (
                  <select
                    id="receive-sku"
                    required
                    value={skuId}
                    onChange={(e) => setSkuId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— Выберите товар —</option>
                    {Object.entries(byCategory).map(([cat, items]) => (
                      <optgroup key={cat} label={cat}>
                        {items.map((sku) => (
                          <option key={sku.id} value={sku.id}>
                            {sku.name} (в наличии: {sku.stockQuantity} {sku.unit})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label htmlFor="receive-qty" className="block text-sm font-medium text-zinc-700 mb-1">
                  Количество *
                  {selectedSku && (
                    <span className="ml-1 font-normal text-zinc-400">({selectedSku.unit})</span>
                  )}
                </label>
                <input
                  id="receive-qty"
                  type="number"
                  required
                  min="1"
                  max="9999"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Например: 24"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Note */}
              <div>
                <label htmlFor="receive-note" className="block text-sm font-medium text-zinc-700 mb-1">
                  Примечание
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

              {/* Stock preview */}
              {selectedSku && quantity && parseInt(quantity) > 0 && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-zinc-700">
                  Будет:{" "}
                  <span className="font-semibold text-green-700">
                    {selectedSku.stockQuantity + parseInt(quantity)} {selectedSku.unit}
                  </span>
                  {" "}(было {selectedSku.stockQuantity})
                </div>
              )}

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
                  disabled={submitting || !skuId || !quantity}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
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
