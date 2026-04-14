"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

const NAV_TABS = [
  { href: "/admin/inventory", label: "Остатки" },
  { href: "/admin/inventory/suppliers", label: "Поставщики" },
  { href: "/admin/inventory/receipts", label: "Приходы" },
  { href: "/admin/inventory/write-offs", label: "Списания" },
  { href: "/admin/inventory/expiring", label: "Истечение" },
  { href: "/admin/inventory/audits", label: "Инвентаризация" },
  { href: "/admin/inventory/movements", label: "Движения" },
  { href: "/admin/inventory/prices", label: "Цены" },
];

type SkuRow = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  lowStockThreshold: number;
};

type EditState = {
  price: string;
  name: string;
  category: string;
  unit: string;
};

export default function PricesPage() {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ price: "", name: "", category: "", unit: "" });
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filterCategory, setFilterCategory] = useState("");

  const loadSkus = useCallback(() => {
    setLoading(true);
    fetch("/api/inventory/sku")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SkuRow[] }) => {
        if (json.success && json.data) {
          setSkus(json.data.map((s) => ({ ...s, price: Number(s.price) })));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSkus();
  }, [loadSkus]);

  const categories = [...new Set(skus.map((s) => s.category))].sort();
  const filtered = filterCategory ? skus.filter((s) => s.category === filterCategory) : skus;

  function startEdit(sku: SkuRow) {
    setEditingId(sku.id);
    setEditState({
      price: String(sku.price),
      name: sku.name,
      category: sku.category,
      unit: sku.unit,
    });
    setBanner(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState({ price: "", name: "", category: "", unit: "" });
  }

  async function saveEdit(id: string) {
    const price = parseFloat(editState.price);
    if (isNaN(price) || price <= 0) {
      setBanner({ type: "error", text: "Цена должна быть больше 0" });
      return;
    }
    if (!editState.name.trim()) {
      setBanner({ type: "error", text: "Название не может быть пустым" });
      return;
    }

    setSaving(true);
    setBanner(null);

    try {
      const res = await fetch(`/api/inventory/sku/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price,
          name: editState.name.trim(),
          category: editState.category.trim() || "Товары",
          unit: editState.unit.trim() || "шт",
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: { message?: string };
      };

      if (json.success) {
        setBanner({ type: "success", text: `Цена "${editState.name}" обновлена` });
        setEditingId(null);
        loadSkus();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка сохранения" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Цены реализации</h1>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/prices"
                  ? "text-blue-600 border-blue-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-900 hover:border-zinc-300"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {banner && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              banner.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Filter */}
        {categories.length > 1 && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-zinc-600">Категория:</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Все ({skus.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c} ({skus.filter((s) => s.category === c).length})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">
              Нет товаров
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Название</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Категория</th>
                    <th className="px-4 py-3 text-center font-medium text-zinc-500">Ед.</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Остаток</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Розн. цена (₽)</th>
                    <th className="px-4 py-3 text-center font-medium text-zinc-500">Статус</th>
                    <th className="px-4 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filtered.map((sku) => {
                    const isEditing = editingId === sku.id;

                    return (
                      <tr
                        key={sku.id}
                        className={`transition-colors ${
                          isEditing ? "bg-blue-50/40" : "hover:bg-zinc-50"
                        }`}
                      >
                        {/* Название */}
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editState.name}
                              onChange={(e) =>
                                setEditState((s) => ({ ...s, name: e.target.value }))
                              }
                              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            <span className={`font-medium ${sku.isActive ? "text-zinc-900" : "text-zinc-400 line-through"}`}>
                              {sku.name}
                            </span>
                          )}
                        </td>

                        {/* Категория */}
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editState.category}
                              onChange={(e) =>
                                setEditState((s) => ({ ...s, category: e.target.value }))
                              }
                              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            <span className="text-zinc-600">{sku.category}</span>
                          )}
                        </td>

                        {/* Единица */}
                        <td className="px-4 py-3 text-center">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editState.unit}
                              onChange={(e) =>
                                setEditState((s) => ({ ...s, unit: e.target.value }))
                              }
                              className="w-16 rounded border border-zinc-300 px-2 py-1 text-sm text-center outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            <span className="text-zinc-500">{sku.unit}</span>
                          )}
                        </td>

                        {/* Остаток */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span
                            className={
                              sku.stockQuantity === 0
                                ? "text-red-600 font-semibold"
                                : sku.stockQuantity <= sku.lowStockThreshold
                                ? "text-orange-600 font-medium"
                                : "text-zinc-700"
                            }
                          >
                            {sku.stockQuantity}
                          </span>
                        </td>

                        {/* Цена */}
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editState.price}
                              onChange={(e) =>
                                setEditState((s) => ({ ...s, price: e.target.value }))
                              }
                              min={0}
                              step="any"
                              className="w-28 rounded border border-blue-400 bg-white px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-blue-500 tabular-nums font-semibold"
                              autoFocus
                            />
                          ) : (
                            <span className="font-semibold text-zinc-900 tabular-nums">
                              {sku.price.toFixed(0)}
                            </span>
                          )}
                        </td>

                        {/* Статус */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              sku.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-zinc-100 text-zinc-500"
                            }`}
                          >
                            {sku.isActive ? "Активен" : "Архив"}
                          </span>
                        </td>

                        {/* Действия */}
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => saveEdit(sku.id)}
                                disabled={saving}
                                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                              >
                                {saving ? "..." : "Сохранить"}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end">
                              <button
                                onClick={() => startEdit(sku)}
                                className="rounded-lg border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                              >
                                Изменить
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-400 text-center">
          Изменение цены или названия товара здесь влияет на все разделы: меню кафе, бронирования, отчёты.
        </p>
      </div>
    </div>
  );
}
