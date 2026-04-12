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
  costPerUnit: string;
  expiresAt: string;
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

function emptyItem(): ReceiptItem {
  return { skuId: "", quantity: "", costPerUnit: "", expiresAt: "" };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
            meta?: { totalPages: number };
          }) => {
            if (json.success && json.data) {
              setReceipts(json.data);
              setTotalPages(json.meta?.totalPages ?? 1);
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
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!receivedAt) errs.receivedAt = "Укажите дату";
    if (items.length === 0) errs.items = "Добавьте хотя бы одну позицию";

    items.forEach((item, i) => {
      if (!item.skuId) errs[`item_${i}_sku`] = "Выберите товар";
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
      const body = {
        supplierId: supplierId || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        receivedAt,
        notes: notes.trim() || undefined,
        items: items.map((it) => ({
          skuId: it.skuId,
          quantity: parseFloat(it.quantity),
          costPerUnit: it.costPerUnit ? parseFloat(it.costPerUnit) : undefined,
          expiresAt: it.expiresAt || undefined,
        })),
      };

      const res = await fetch("/api/inventory/receipts-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };

      if (json.success) {
        setBanner({ type: "success", text: "Приход записан успешно" });
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

  const inputCls = (field: string) =>
    `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
      errors[field] ? "border-red-400 bg-red-50" : "border-zinc-300"
    }`;

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
                  className={inputCls("receivedAt")}
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

            {/* Items table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-700">
                  Позиции <span className="text-red-500">*</span>
                </h3>
                <button
                  type="button"
                  onClick={addItem}
                  className="text-sm text-blue-600 hover:underline"
                >
                  + Добавить строку
                </button>
              </div>

              {errors.items && (
                <p className="mb-2 text-xs text-red-600">{errors.items}</p>
              )}

              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 min-w-[200px]">
                        Товар
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 w-28">
                        Кол-во
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 w-36">
                        Цена за ед. (₽)
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-500 w-36">
                        Срок годности
                      </th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <select
                            value={item.skuId}
                            onChange={(e) => updateItem(i, "skuId", e.target.value)}
                            className={`w-full rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 ${
                              errors[`item_${i}_sku`]
                                ? "border-red-400 bg-red-50"
                                : "border-zinc-300"
                            }`}
                          >
                            <option value="">— Выберите товар —</option>
                            {skus.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.unit})
                              </option>
                            ))}
                          </select>
                          {errors[`item_${i}_sku`] && (
                            <p className="mt-0.5 text-xs text-red-600">
                              {errors[`item_${i}_sku`]}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(i, "quantity", e.target.value)}
                            min={0.001}
                            step="any"
                            placeholder="0"
                            className={`w-full rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 ${
                              errors[`item_${i}_qty`]
                                ? "border-red-400 bg-red-50"
                                : "border-zinc-300"
                            }`}
                          />
                          {errors[`item_${i}_qty`] && (
                            <p className="mt-0.5 text-xs text-red-600">
                              {errors[`item_${i}_qty`]}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.costPerUnit}
                            onChange={(e) => updateItem(i, "costPerUnit", e.target.value)}
                            min={0}
                            step="any"
                            placeholder="Не указано"
                            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={item.expiresAt}
                            onChange={(e) => updateItem(i, "expiresAt", e.target.value)}
                            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeItem(i)}
                              className="text-zinc-400 hover:text-red-500 text-lg leading-none"
                              aria-label="Удалить строку"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      <tr key={r.id} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                          {formatDate(r.receivedAt)}
                        </td>
                        <td className="px-4 py-3 text-zinc-900">
                          {r.supplier?.name ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-zinc-600">
                          {r.invoiceNumber ?? <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                          {r.items.length}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-xs truncate">
                          {r.notes ?? "—"}
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
