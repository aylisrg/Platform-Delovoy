"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReceiptHistoryRow } from "@/modules/inventory/types";

const today = () => new Date().toISOString().slice(0, 10);

function formatDate(isoString: string) {
  return new Date(isoString).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function InventoryReceiveForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState(today());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ text: string } | null>(null);

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Название обязательно";
    else if (name.length > 200) errs.name = "Не более 200 символов";

    const qty = parseInt(quantity, 10);
    if (!quantity || isNaN(qty) || qty < 1) errs.quantity = "Введите целое число больше 0";

    if (receivedAt > today()) errs.receivedAt = "Дата прихода не может быть в будущем";

    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const res = await fetch("/api/inventory/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          quantity: parseInt(quantity, 10),
          note: note.trim() || undefined,
          receivedAt,
        }),
      });
      const json = await res.json();

      if (json.success) {
        setBanner({
          text: `Приход записан: ${json.data.name}, +${parseInt(quantity, 10)} шт. Текущий остаток: ${json.data.newStockQuantity} шт.`,
        });
        setName("");
        setQuantity("");
        setNote("");
        setReceivedAt(today());
        onSuccess();
      } else {
        setErrors({ form: json.error?.message ?? "Ошибка при сохранении" });
      }
    } catch {
      setErrors({ form: "Ошибка сети" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 text-lg font-semibold text-zinc-900">Записать приход товара</h2>

      {banner && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {banner.text}
        </div>
      )}

      {errors.form && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {errors.form}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Название товара <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="Например: Coca-Cola 0.5л"
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.name ? "border-red-400 bg-red-50" : "border-zinc-300"
            }`}
          />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Количество <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min={1}
              step={1}
              placeholder="0"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.quantity ? "border-red-400 bg-red-50" : "border-zinc-300"
              }`}
            />
            {errors.quantity && <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              Дата прихода <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              max={today()}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.receivedAt ? "border-red-400 bg-red-50" : "border-zinc-300"
              }`}
            />
            {errors.receivedAt && (
              <p className="mt-1 text-xs text-red-600">{errors.receivedAt}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Примечание <span className="text-zinc-400 text-xs font-normal">(необязательно)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Поставщик, номер накладной и т.д."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Сохраняем..." : "Записать приход"}
        </button>
      </form>
    </div>
  );
}

function InventoryReceiptsTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<ReceiptHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/receipts");
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
      } else {
        setError("Не удалось загрузить историю приходов");
      }
    } catch {
      setError("Ошибка сети при загрузке истории");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">История приходов</h2>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-zinc-900">История приходов</h2>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <h2 className="text-lg font-semibold text-zinc-900">История приходов</h2>
        <span className="text-sm text-zinc-400">{rows.length} записей</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-zinc-400">Приходов пока нет</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Дата прихода</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Название товара</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Количество</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Примечание</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Кто записал</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                    {formatDate(row.receivedAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{row.skuName}</td>
                  <td className="px-4 py-3 text-right text-green-700 font-semibold whitespace-nowrap">
                    +{row.quantity} шт
                  </td>
                  <td className="px-4 py-3 text-zinc-500 max-w-xs truncate">
                    {row.note ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                    {row.performedByName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function InventoryInteractive() {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSuccess() {
    setRefreshKey((k) => k + 1);
    router.refresh(); // re-render server components (stock catalog)
  }

  return (
    <div className="space-y-6">
      <InventoryReceiveForm onSuccess={handleSuccess} />
      <InventoryReceiptsTable refreshKey={refreshKey} />
    </div>
  );
}
