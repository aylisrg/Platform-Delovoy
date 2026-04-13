"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Office = {
  id: string;
  number: string;
  floor: number;
  building: number;
  officeType: string;
  area: number;
  pricePerMonth: number;
  hasWetPoint: boolean;
  hasToilet: boolean;
  hasRoofAccess: boolean;
  status: string;
  comment: string | null;
};

export function OfficeEditModal({
  office,
  open,
  onClose,
}: {
  office: Office;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...office });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {};
    if (form.number !== office.number) body.number = form.number;
    if (form.floor !== office.floor) body.floor = form.floor;
    if (form.building !== office.building) body.building = form.building;
    if (form.officeType !== office.officeType) body.officeType = form.officeType;
    if (form.area !== office.area) body.area = form.area;
    if (form.pricePerMonth !== office.pricePerMonth) body.pricePerMonth = form.pricePerMonth;
    if (form.hasWetPoint !== office.hasWetPoint) body.hasWetPoint = form.hasWetPoint;
    if (form.hasToilet !== office.hasToilet) body.hasToilet = form.hasToilet;
    if (form.hasRoofAccess !== office.hasRoofAccess) body.hasRoofAccess = form.hasRoofAccess;
    if (form.status !== office.status) body.status = form.status;
    if (form.comment !== office.comment) body.comment = form.comment;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/rental/offices/${office.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        onClose();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Ошибка сохранения");
      }
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">
            Помещение К{office.building}·{office.number}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Номер *</label>
              <input
                type="text"
                required
                value={form.number}
                onChange={(e) => set("number", e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Корпус *</label>
              <input
                type="number"
                required
                min={1}
                value={form.building}
                onChange={(e) => set("building", Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Этаж *</label>
              <input
                type="number"
                required
                min={1}
                value={form.floor}
                onChange={(e) => set("floor", Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Тип</label>
              <select
                value={form.officeType}
                onChange={(e) => set("officeType", e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="OFFICE">Офис</option>
                <option value="CONTAINER">Контейнер</option>
                <option value="MEETING_ROOM">Переговорная</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Статус</label>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="AVAILABLE">Свободен</option>
                <option value="OCCUPIED">Занят</option>
                <option value="MAINTENANCE">Обслуживание</option>
                <option value="RESERVED">Резерв</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Площадь (м²) *</label>
              <input
                type="number"
                required
                step="0.1"
                min="0.1"
                value={form.area}
                onChange={(e) => set("area", Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Цена/мес (₽)</label>
              <input
                type="number"
                min="0"
                step="100"
                value={form.pricePerMonth}
                onChange={(e) => set("pricePerMonth", Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 py-1">
            {[
              { key: "hasWetPoint" as const, label: "Мокрая точка" },
              { key: "hasToilet" as const, label: "Туалет" },
              { key: "hasRoofAccess" as const, label: "Доступ к кровле" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <input
                  id={`${key}-${office.id}`}
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor={`${key}-${office.id}`} className="text-sm text-zinc-700">
                  {label}
                </label>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Комментарий</label>
            <input
              type="text"
              value={form.comment ?? ""}
              onChange={(e) => set("comment", e.target.value || null)}
              placeholder="игровой центр, склад..."
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
