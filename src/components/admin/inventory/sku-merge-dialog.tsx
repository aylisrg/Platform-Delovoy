"use client";

import { useState } from "react";

type SkuOption = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stockQuantity: number;
};

type Props = {
  group: SkuOption[];
  onMerged: () => void;
};

export function SkuMergeDialog({ group, onMerged }: Props) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(group[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = group.find((s) => s.id !== targetId)!;
  const target = group.find((s) => s.id === targetId)!;

  async function handleMerge() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/sku/${source.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSkuId: targetId }),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };
      if (!json.success) {
        setError(json.error?.message ?? "Ошибка объединения");
        setLoading(false);
        return;
      }
      setOpen(false);
      onMerged();
    } catch {
      setError("Сеть недоступна");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null); setTargetId(group[0].id); }}
        className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900 transition-colors"
      >
        Объединить
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-zinc-900">Объединение дублей</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Выберите основной товар. Остатки, приходы и история второго будут перенесены в него, сам дубль будет архивирован.
            </p>

            <div className="mt-4 space-y-2">
              {group.map((sku) => (
                <label
                  key={sku.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    targetId === sku.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="targetSku"
                    value={sku.id}
                    checked={targetId === sku.id}
                    onChange={() => setTargetId(sku.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{sku.name}</p>
                    <p className="text-xs text-zinc-500">
                      {sku.category} · {sku.stockQuantity} {sku.unit}
                    </p>
                  </div>
                  {targetId === sku.id && (
                    <span className="ml-auto shrink-0 text-xs font-medium text-blue-600">Основной</span>
                  )}
                </label>
              ))}
            </div>

            {group.length === 2 && (
              <p className="mt-3 text-xs text-zinc-400">
                «{source.name}» ({source.stockQuantity} {source.unit}) → «{target.name}»
              </p>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={handleMerge}
                disabled={loading}
                className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {loading ? "Объединяем..." : "Объединить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
