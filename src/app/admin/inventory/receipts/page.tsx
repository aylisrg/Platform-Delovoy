"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

type SkuOption = {
  id: string;
  name: string;
  category: string;
  unit: string;
};

type SupplierOption = {
  id: string;
  name: string;
  isActive: boolean;
};

type ReceiptItem = {
  skuId: string;
  quantity: string;
  totalCost: string;
  isNew: boolean;
  newName: string;
  newCategory: string;
  newUnit: string;
  newPrice: string;
};

type ReceiptHistoryEntry = {
  id: string;
  receivedAt: string;
  invoiceNumber: string | null;
  notes: string | null;
  supplier: { id: string; name: string } | null;
  items: Array<{ sku: { name: string }; quantity: number }>;
};

const today = () => new Date().toISOString().slice(0, 10);

const NEW_SKU_VALUE = "__new__";

function emptyItem(): ReceiptItem {
  return { skuId: "", quantity: "", totalCost: "", isNew: false, newName: "", newCategory: "Товары", newUnit: "шт", newPrice: "" };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function computeCostPerUnit(qty: string, totalCost: string): number | undefined {
  const q = parseFloat(qty);
  const t = parseFloat(totalCost);
  if (!q || !t || q <= 0 || t <= 0) return undefined;
  return Math.round((t / q) * 100) / 100;
}

export default function ReceiptsPage() {
  const router = useRouter();
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [receipts, setReceipts] = useState<ReceiptHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Form state
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [receivedAt, setReceivedAt] = useState(today());
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ReceiptItem[]>([emptyItem()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 20;

  useEffect(() => {
    fetch("/api/inventory/sku")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SkuOption[] }) => {
        if (json.success && json.data) setSkus(json.data);
      })
      .catch(() => undefined);

    fetch("/api/inventory/suppliers?isActive=true")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SupplierOption[] }) => {
        if (json.success && json.data) setSuppliers(json.data);
      })
      .catch(() => undefined);
  }, []);

  const loadHistory = useCallback(
    (p: number) => {
      setHistoryLoading(true);
      fetch(`/api/inventory/receipts-v2?page=${p}&perPage=${perPage}`)
        .then((r) => r.json())
        .then(
          (json: {
            success: boolean;
            data?: ReceiptHistoryEntry[];
            meta?: { total: number; perPage: number };
          }) => {
            if (json.success && json.data) {
              setReceipts(json.data);
              const total = json.meta?.total ?? 0;
              const pp = json.meta?.perPage ?? perPage;
              setTotalPages(Math.max(1, Math.ceil(total / pp)));
            }
          }
        )
        .catch(() => undefined)
        .finally(() => setHistoryLoading(false));
    },
    [perPage]
  );

  useEffect(() => {
    loadHistory(page);
  }, [loadHistory, page]);

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateItem(i: number, field: keyof ReceiptItem, value: string) {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== i) return item;
      if (field === "skuId" && value === NEW_SKU_VALUE) {
        return { ...item, skuId: "", isNew: true };
      }
      if (field === "skuId" && value !== NEW_SKU_VALUE) {
        return { ...item, skuId: value, isNew: false, newName: "", newCategory: "Товары", newUnit: "шт", newPrice: "" };
      }
      const updated = { ...item, [field]: value };
      // Auto-fill recommended retail price for new items (2x markup)
      if (updated.isNew && (field === "quantity" || field === "totalCost")) {
        const cpu = computeCostPerUnit(updated.quantity, updated.totalCost);
        if (cpu !== undefined && !item.newPrice) {
          updated.newPrice = String(Math.ceil(cpu * 2));
        }
      }
      return updated;
    }));
  }

  function getSkuName(skuId: string) {
    return skus.find((s) => s.id === skuId);
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!receivedAt) errs.receivedAt = "Укажите дату";
    if (items.length === 0) errs.items = "Добавьте хотя бы одну позицию";

    items.forEach((item, i) => {
      if (item.isNew) {
        if (!item.newName.trim()) errs[`item_${i}_sku`] = "Введите название товара";
        const price = parseFloat(item.newPrice);
        if (!item.newPrice || isNaN(price) || price <= 0)
          errs[`item_${i}_price`] = "Укажите цену продажи > 0";
      } else {
        if (!item.skuId) errs[`item_${i}_sku`] = "Выберите товар";
      }
      const qty = parseFloat(item.quantity);
      if (!item.quantity || isNaN(qty) || qty <= 0)
        errs[`item_${i}_qty`] = "Введите количество > 0";
    });

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
      // Create any new SKUs first
      const resolvedItems = [...items];
      for (let i = 0; i < resolvedItems.length; i++) {
        const it = resolvedItems[i];
        if (!it.isNew) continue;

        const skuRes = await fetch("/api/inventory/sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: it.newName.trim(),
            category: it.newCategory.trim() || "Товары",
            unit: it.newUnit.trim() || "шт",
            price: parseFloat(it.newPrice),
          }),
        });
        const skuJson = await skuRes.json() as { success: boolean; data?: { id: string; name: string; category: string; unit: string }; error?: { message?: string } };
        if (!skuJson.success || !skuJson.data) {
          setBanner({ type: "error", text: skuJson.error?.message ?? `Не удалось создать товар "${it.newName}"` });
          setLoading(false);
          return;
        }
        resolvedItems[i] = { ...it, skuId: skuJson.data.id, isNew: false };
        // Add to local list so it appears in dropdowns
        setSkus((prev) => [...prev, { id: skuJson.data!.id, name: skuJson.data!.name, category: skuJson.data!.category, unit: skuJson.data!.unit }]);
      }

      const body = {
        supplierId: supplierId || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        receivedAt,
        notes: notes.trim() || undefined,
        items: resolvedItems.map((it) => ({
          skuId: it.skuId,
          quantity: parseFloat(it.quantity),
          costPerUnit: computeCostPerUnit(it.quantity, it.totalCost),
        })),
      };

      const res = await fetch("/api/inventory/receipts-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as {
        success: boolean;
        data?: { status?: string; autoConfirmed?: boolean; confirmError?: string };
        error?: { message?: string };
      };

      if (json.success) {
        const autoConfirmed = json.data?.autoConfirmed === true || json.data?.status === "CONFIRMED";
        const confirmError = json.data?.confirmError;
        setBanner(
          autoConfirmed
            ? { type: "success", text: "Приход записан и подтверждён — остатки обновлены" }
            : confirmError
              ? { type: "error", text: `Приход записан, но подтверждение не прошло: ${confirmError}. Остатки не обновлены.` }
              : { type: "success", text: "Приход записан. Ожидает подтверждения администратором — остатки обновятся после этого." }
        );
        setSupplierId("");
        setInvoiceNumber("");
        setReceivedAt(today());
        setNotes("");
        setItems([emptyItem()]);
        loadHistory(1);
        setPage(1);
        router.refresh();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка при сохранении" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Приходы</h1>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/receipts"
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

        {/* New receipt form */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-zinc-900">Форма нового прихода</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Поставщик</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Без поставщика —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">№ накладной</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  maxLength={100}
                  placeholder="Необязательно"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
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

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Примечания</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  placeholder="Необязательно"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Items as cards */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-700">
                  Позиции <span className="text-red-500">*</span>
                </h3>
                <button
                  type="button"
                  onClick={addItem}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  + Добавить товар
                </button>
              </div>

              {errors.items && (
                <p className="mb-2 text-xs text-red-600">{errors.items}</p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, i) => {
                  const sku = getSkuName(item.skuId);
                  const costPerUnit = computeCostPerUnit(item.quantity, item.totalCost);
                  return (
                    <div
                      key={i}
                      className={`relative rounded-xl border p-4 transition-colors ${
                        errors[`item_${i}_sku`] || errors[`item_${i}_qty`]
                          ? "border-red-300 bg-red-50/30"
                          : "border-zinc-200 bg-white hover:border-zinc-300"
                      }`}
                    >
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                          aria-label="Удалить"
                        >
                          ×
                        </button>
                      )}

                      {/* Товар */}
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-zinc-500 mb-1">Товар</label>
                        {!item.isNew ? (
                          <>
                            <select
                              value={item.skuId}
                              onChange={(e) => updateItem(i, "skuId", e.target.value)}
                              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors[`item_${i}_sku`] ? "border-red-400 bg-red-50" : "border-zinc-300"
                              }`}
                            >
                              <option value="">— Выберите товар —</option>
                              {skus.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.unit})
                                </option>
                              ))}
                              <option value={NEW_SKU_VALUE}>+ Новый товар...</option>
                            </select>
                            {errors[`item_${i}_sku`] && (
                              <p className="mt-0.5 text-xs text-red-600">{errors[`item_${i}_sku`]}</p>
                            )}
                          </>
                        ) : (
                          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/30 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-blue-700">Новый товар</span>
                              <button
                                type="button"
                                onClick={() => updateItem(i, "skuId", "")}
                                className="text-xs text-zinc-500 hover:text-zinc-700"
                              >
                                Отмена
                              </button>
                            </div>
                            <input
                              type="text"
                              value={item.newName}
                              onChange={(e) => updateItem(i, "newName" as keyof ReceiptItem, e.target.value)}
                              placeholder="Название *"
                              className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                                errors[`item_${i}_sku`] ? "border-red-400 bg-red-50" : "border-zinc-300"
                              }`}
                            />
                            {errors[`item_${i}_sku`] && (
                              <p className="text-xs text-red-600">{errors[`item_${i}_sku`]}</p>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={item.newCategory}
                                onChange={(e) => updateItem(i, "newCategory" as keyof ReceiptItem, e.target.value)}
                                placeholder="Категория"
                                className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <input
                                type="text"
                                value={item.newUnit}
                                onChange={(e) => updateItem(i, "newUnit" as keyof ReceiptItem, e.target.value)}
                                placeholder="Ед. изм."
                                className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            {costPerUnit !== undefined && (
                              <div className="flex items-center gap-2 pt-1">
                                <label className="text-xs text-zinc-500 whitespace-nowrap">Розн. цена</label>
                                <input
                                  type="number"
                                  value={item.newPrice}
                                  onChange={(e) => updateItem(i, "newPrice" as keyof ReceiptItem, e.target.value)}
                                  placeholder={`Рек. ${(costPerUnit * 2).toFixed(0)} ₽`}
                                  min={0}
                                  step="any"
                                  className={`w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 tabular-nums ${
                                    errors[`item_${i}_price`] ? "border-red-400 bg-red-50" : "border-zinc-300"
                                  }`}
                                />
                              </div>
                            )}
                            {!costPerUnit && (
                              <div className="flex items-center gap-2 pt-1">
                                <label className="text-xs text-zinc-500 whitespace-nowrap">Розн. цена</label>
                                <input
                                  type="number"
                                  value={item.newPrice}
                                  onChange={(e) => updateItem(i, "newPrice" as keyof ReceiptItem, e.target.value)}
                                  placeholder="Цена продажи *"
                                  min={0}
                                  step="any"
                                  className={`w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 tabular-nums ${
                                    errors[`item_${i}_price`] ? "border-red-400 bg-red-50" : "border-zinc-300"
                                  }`}
                                />
                              </div>
                            )}
                            {errors[`item_${i}_price`] && (
                              <p className="text-xs text-red-600">{errors[`item_${i}_price`]}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Кол-во + Цена позиции */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-zinc-500 mb-1">
                            Кол-во{sku ? ` (${sku.unit})` : item.isNew && item.newUnit ? ` (${item.newUnit})` : ""}
                          </label>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(i, "quantity", e.target.value)}
                            min={1}
                            step={1}
                            placeholder="0"
                            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 tabular-nums ${
                              errors[`item_${i}_qty`] ? "border-red-400 bg-red-50" : "border-zinc-300"
                            }`}
                          />
                          {errors[`item_${i}_qty`] && (
                            <p className="mt-0.5 text-xs text-red-600">{errors[`item_${i}_qty`]}</p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-zinc-500 mb-1">
                            Цена закупки (₽)
                          </label>
                          <input
                            type="number"
                            value={item.totalCost}
                            onChange={(e) => updateItem(i, "totalCost", e.target.value)}
                            min={0}
                            step="any"
                            placeholder="За всю позицию"
                            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
                          />
                        </div>
                      </div>

                      {/* Итог блока */}
                      {costPerUnit !== undefined && (
                        <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-100 px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Сумма позиции</span>
                            <span className="font-semibold text-zinc-900 tabular-nums">
                              {parseFloat(item.totalCost).toLocaleString("ru-RU", { minimumFractionDigits: 0 })} ₽
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Закупка за ед.</span>
                            <span className="font-medium text-zinc-700 tabular-nums">
                              {costPerUnit.toFixed(2)} ₽
                            </span>
                          </div>
                          <div className="border-t border-zinc-200 pt-1.5 flex items-center justify-between text-xs">
                            <span className="text-zinc-500">Рек. розничная цена</span>
                            <span className="font-semibold text-green-700 tabular-nums">
                              {(costPerUnit * 2).toFixed(0)} ₽
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Записываем..." : "Записать приход"}
            </button>
          </form>
        </div>

        {/* History */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">История приходов</h2>
          </div>

          {historyLoading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : receipts.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">Приходов пока нет</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Дата</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Поставщик</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Накладная</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Позиций</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Примечания</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {receipts.map((r) => (
                      <tr key={r.id} className="hover:bg-zinc-50 cursor-pointer">
                        <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                          <Link href={`/admin/inventory/receipts/${r.id}`} className="hover:text-blue-600">
                            {formatDate(r.receivedAt)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-zinc-900">
                          <Link href={`/admin/inventory/receipts/${r.id}`} className="hover:text-blue-600">
                            {r.supplier?.name ?? <span className="text-zinc-400">—</span>}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-zinc-600">
                          <Link href={`/admin/inventory/receipts/${r.id}`} className="hover:text-blue-600">
                            {r.invoiceNumber ?? <span className="text-zinc-400">—</span>}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                          <Link href={`/admin/inventory/receipts/${r.id}`} className="hover:text-blue-600">
                            {r.items.length}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-xs truncate">
                          <Link href={`/admin/inventory/receipts/${r.id}`} className="hover:text-blue-600">
                            {r.notes ?? "—"}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-zinc-100">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    ← Назад
                  </button>
                  <span className="text-sm text-zinc-500">
                    Стр. {page} из {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Вперёд →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
