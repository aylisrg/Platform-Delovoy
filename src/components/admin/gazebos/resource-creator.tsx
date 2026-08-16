"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PriceList = {
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
};

// Число из строки поля; пустое → 0 (та же конвенция, что в ResourceEditor).
const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function ResourceCreator() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [weekdayHour, setWeekdayHour] = useState("");
  const [weekdayDay, setWeekdayDay] = useState("");
  const [weekendHour, setWeekendHour] = useState("");
  const [weekendDay, setWeekendDay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setCapacity("");
    setWeekdayHour("");
    setWeekdayDay("");
    setWeekendHour("");
    setWeekendDay("");
    setError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Название обязательно");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const priceList: PriceList = {
        weekdayHour: num(weekdayHour),
        weekdayDay: num(weekdayDay),
        weekendHour: num(weekendHour),
        weekendDay: num(weekendDay),
      };
      const res = await fetch("/api/gazebos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() && { description: description.trim() }),
          ...(capacity !== "" && { capacity: parseInt(capacity, 10) }),
          // pricePerHour = будний час, как в ResourceEditor; матрица целиком в metadata.
          ...(priceList.weekdayHour > 0 && { pricePerHour: priceList.weekdayHour }),
          metadata: { priceList },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка при создании");
      }
    } catch {
      setError("Не удалось создать беседку");
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
        className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        + Добавить беседку
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-zinc-900">Новая беседка</h2>
              <button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Название <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например: Беседка №5"
                  className={field}
                />
              </div>

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
              </fieldset>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? "Создание..." : "Добавить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
