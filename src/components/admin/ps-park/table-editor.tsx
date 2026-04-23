"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PSTable = {
  id: string;
  name: string;
  capacity: number | null;
  pricePerHour: string | number | null;
  isActive: boolean;
};

export function TableEditor({ table }: { table: PSTable }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(
    table.pricePerHour != null ? String(Number(table.pricePerHour)) : ""
  );
  const [isActive, setIsActive] = useState(table.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { isActive };
      if (price !== "") {
        body.pricePerHour = parseFloat(price);
      }
      const res = await fetch(`/api/ps-park/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка при сохранении");
      }
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
      >
        Изменить
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-zinc-900">{table.name}</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Цена в час (₽)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  id={`active-${table.id}`}
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor={`active-${table.id}`} className="text-sm font-medium text-zinc-700">
                  Стол активен (принимает бронирования)
                </label>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
