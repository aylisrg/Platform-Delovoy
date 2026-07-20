"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PriceList = {
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
};

type Resource = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  pricePerHour: string | number | null;
  isActive: boolean;
  metadata: unknown;
};

function extractPriceList(metadata: unknown, pricePerHour: number | null): PriceList {
  if (metadata && typeof metadata === "object" && "priceList" in metadata) {
    const pl = (metadata as { priceList: unknown }).priceList;
    if (
      pl &&
      typeof pl === "object" &&
      typeof (pl as PriceList).weekdayHour === "number"
    ) {
      return pl as PriceList;
    }
  }
  const base = pricePerHour ?? 0;
  return { weekdayHour: base, weekdayDay: base * 10, weekendHour: base, weekendDay: base * 10 };
}

// Число из строки поля; пустое → 0 (для необязательных дневных ставок).
const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function ResourceEditor({ resource }: { resource: Resource }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialPl = extractPriceList(
    resource.metadata,
    resource.pricePerHour != null ? Number(resource.pricePerHour) : null
  );

  const [description, setDescription] = useState(resource.description ?? "");
  const [capacity, setCapacity] = useState(
    resource.capacity != null ? String(resource.capacity) : ""
  );
  const [weekdayHour, setWeekdayHour] = useState(String(initialPl.weekdayHour));
  const [weekdayDay, setWeekdayDay] = useState(String(initialPl.weekdayDay));
  const [weekendHour, setWeekendHour] = useState(String(initialPl.weekendHour));
  const [weekendDay, setWeekendDay] = useState(String(initialPl.weekendDay));
  const [isActive, setIsActive] = useState(resource.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const priceList: PriceList = {
        weekdayHour: num(weekdayHour),
        weekdayDay: num(weekdayDay),
        weekendHour: num(weekendHour),
        weekendDay: num(weekendDay),
      };
      // Сохраняем полную матрицу в metadata (источник для публичной таблицы),
      // а pricePerHour = будний час («от X ₽/час» в карточках и калькуляторе).
      const existingMeta =
        resource.metadata && typeof resource.metadata === "object"
          ? (resource.metadata as Record<string, unknown>)
          : {};
      const res = await fetch(`/api/gazebos/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim() || undefined,
          ...(capacity !== "" && { capacity: parseInt(capacity, 10) }),
          pricePerHour: priceList.weekdayHour,
          metadata: { ...existingMeta, priceList },
          isActive,
        }),
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

  const field =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

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
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-zinc-900">{resource.name}</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Описание</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Например: Большая беседка с отоплением, до 20 человек"
                  className={field}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Вместимость (чел.)</label>
                <input
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className={field}
                />
              </div>

              <fieldset className="rounded-lg border border-zinc-200 p-3">
                <legend className="px-1 text-xs font-medium text-zinc-500">Прайс, ₽</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Пн–Чт, час</label>
                    <input type="number" min="0" step="50" value={weekdayHour} onChange={(e) => setWeekdayHour(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Пн–Чт, день</label>
                    <input type="number" min="0" step="500" value={weekdayDay} onChange={(e) => setWeekdayDay(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Пт–Вс, час</label>
                    <input type="number" min="0" step="50" value={weekendHour} onChange={(e) => setWeekendHour(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Пт–Вс, день</label>
                    <input type="number" min="0" step="500" value={weekendDay} onChange={(e) => setWeekendDay(e.target.value)} className={field} />
                  </div>
                </div>
                <p className="text-xs text-zinc-400 mt-2">
                  «Пн–Чт, час» показывается как «от X ₽/час» в карточках и калькуляторе.
                </p>
              </fieldset>

              <div className="flex items-center gap-3">
                <input
                  id={`active-${resource.id}`}
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor={`active-${resource.id}`} className="text-sm font-medium text-zinc-700">
                  Беседка активна (принимает бронирования)
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
