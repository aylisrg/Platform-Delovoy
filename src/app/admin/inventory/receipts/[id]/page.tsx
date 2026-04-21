"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Receipt = {
  id: string;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  invoiceNumber: string | null;
  receivedAt: string;
  notes: string | null;
  status: string;
  moduleSlug: string | null;
  performedById: string;
  createdAt: string;
  items: Array<{
    id: string;
    skuId: string;
    sku: { id: string; name: string; unit: string };
    quantity: number;
    costPerUnit: number | null;
    expiresAt: string | null;
  }>;
};

type ReceiptItem = {
  skuId: string;
  quantity: number;
  costPerUnit: number | null;
};

type Correction = {
  id: string;
  correctedById: string;
  correctedByName: string | null;
  reason: string | null;
  itemsBefore: ReceiptItem[];
  itemsAfter: ReceiptItem[];
  createdAt: string;
};

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

function getStatusBadge(status: string) {
  const badges: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-gray-50", text: "text-gray-700", label: "Черновик" },
    CONFIRMED: { bg: "bg-green-50", text: "text-green-700", label: "Подтверждён" },
    PROBLEM: { bg: "bg-yellow-50", text: "text-yellow-700", label: "Проблема" },
    CORRECTED: { bg: "bg-blue-50", text: "text-blue-700", label: "Скорректирован" },
  };
  const badge = badges[status] || { bg: "bg-gray-50", text: "text-gray-700", label: status };
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session } = useSession();
  const [id, setId] = useState<string>("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  // Form state
  const [editMode, setEditMode] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setId(p.id);
    })();
  }, [params]);

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      try {
        setLoading(true);

        const [receiptRes, skuRes, supplierRes] = await Promise.all([
          fetch(`/api/inventory/receipts-v2/${id}`),
          fetch("/api/inventory/sku"),
          fetch("/api/inventory/suppliers?isActive=true"),
        ]);

        if (receiptRes.ok) {
          const rJson = await receiptRes.json();
          if (rJson.success && rJson.data) {
            setReceipt(rJson.data);
            setSupplierId(rJson.data.supplierId || "");
            setInvoiceNumber(rJson.data.invoiceNumber || "");
            setReceivedAt(rJson.data.receivedAt.slice(0, 10));
            setNotes(rJson.data.notes || "");
            setItems(
              rJson.data.items.map((item: Receipt["items"][number]) => ({
                skuId: item.skuId,
                quantity: item.quantity,
                costPerUnit: item.costPerUnit,
              }))
            );

            // Load corrections if user can see them
            const corrRes = await fetch(`/api/inventory/receipts-v2/${id}/corrections`);
            if (corrRes.ok) {
              const corrJson = await corrRes.json();
              if (corrJson.success && corrJson.data) {
                setCorrections(corrJson.data);
              }
            }
          }
        }

        if (skuRes.ok) {
          const skuJson = await skuRes.json();
          if (skuJson.success && skuJson.data) setSkus(skuJson.data);
        }

        if (supplierRes.ok) {
          const supplierJson = await supplierRes.json();
          if (supplierJson.success && supplierJson.data) setSuppliers(supplierJson.data);
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  const canEdit = useCallback(() => {
    if (!receipt || !session?.user) return false;
    if (session.user.role === "MANAGER") {
      return receipt.performedById === session.user.id && (receipt.status === "DRAFT" || receipt.status === "PROBLEM");
    }
    return (session.user.role === "ADMIN" || session.user.role === "SUPERADMIN") && (receipt.status === "DRAFT" || receipt.status === "PROBLEM");
  }, [receipt, session?.user]);

  const canCorrect = useCallback(() => {
    if (!receipt || !session?.user) return false;
    return (session.user.role === "ADMIN" || session.user.role === "SUPERADMIN") && (receipt.status === "CONFIRMED" || receipt.status === "CORRECTED");
  }, [receipt, session?.user]);

  const canModify = useCallback(() => {
    return canEdit() || canCorrect();
  }, [canEdit, canCorrect]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!receipt) return;

    setBanner(null);
    setSubmitting(true);

    try {
      const body: {
        supplierId: string | null;
        invoiceNumber: string | null;
        receivedAt: string;
        notes: string | null;
        items: Array<{ skuId: string; quantity: number; costPerUnit: number | null }>;
        correctionReason?: string;
      } = {
        supplierId: supplierId || null,
        invoiceNumber: invoiceNumber.trim() || null,
        receivedAt,
        notes: notes.trim() || null,
        items: items.map((item) => ({
          skuId: item.skuId,
          quantity: parseInt(String(item.quantity)),
          costPerUnit: item.costPerUnit ? parseFloat(String(item.costPerUnit)) : null,
        })),
      };

      if (canCorrect()) {
        body.correctionReason = correctionReason.trim();
        if (!body.correctionReason) {
          setBanner({ type: "error", text: "Укажите причину коррекции" });
          setSubmitting(false);
          return;
        }
      }

      const res = await fetch(`/api/inventory/receipts-v2/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (json.success) {
        setBanner({ type: "success", text: canCorrect() ? "Коррекция сохранена" : "Приход обновлён" });
        setEditMode(false);
        setCorrectionReason("");

        // Reload data
        const receiptRes = await fetch(`/api/inventory/receipts-v2/${id}`);
        if (receiptRes.ok) {
          const rJson = await receiptRes.json();
          if (rJson.success && rJson.data) {
            setReceipt(rJson.data);
          }
        }

        const corrRes = await fetch(`/api/inventory/receipts-v2/${id}/corrections`);
        if (corrRes.ok) {
          const corrJson = await corrRes.json();
          if (corrJson.success && corrJson.data) {
            setCorrections(corrJson.data);
          }
        }
      } else {
        setBanner({ type: "error", text: json.error?.message || "Ошибка при сохранении" });
      }
    } catch (err) {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setSubmitting(false);
    }
  }

  function updateItem(idx: number, field: keyof ReceiptItem, value: string | number | null) {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (field === "skuId") return { ...item, skuId: value as string };
        if (field === "quantity") return { ...item, quantity: typeof value === "string" ? parseInt(value) || 0 : (value as number) };
        if (field === "costPerUnit") return { ...item, costPerUnit: typeof value === "string" ? (value ? parseFloat(value) : null) : (value as number | null) };
        return item;
      })
    );
  }

  const getSkuName = (skuId: string) => skus.find((s) => s.id === skuId);
  const getItemsChanges = (before: ReceiptItem[], after: ReceiptItem[]) => {
    const changes: Array<{ skuId: string; oldQty: number; qty: number; delta: number }> = [];
    const skuIds = new Set([...before.map((b) => b.skuId), ...after.map((a) => a.skuId)]);

    for (const skuId of skuIds) {
      const beforeItem = before.find((b) => b.skuId === skuId);
      const afterItem = after.find((a) => a.skuId === skuId);
      const qty = afterItem?.quantity || 0;
      const oldQty = beforeItem?.quantity || 0;
      const delta = qty - oldQty;
      if (delta !== 0) {
        changes.push({ skuId, oldQty, qty, delta });
      }
    }
    return changes;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
          <h1 className="text-xl font-semibold text-zinc-900">Загрузка...</h1>
        </header>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
          <h1 className="text-xl font-semibold text-zinc-900">Приход не найден</h1>
        </header>
        <div className="p-6">
          <Link href="/admin/inventory/receipts" className="text-blue-600 hover:underline">
            ← Назад
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <div className="flex items-center gap-3">
          <Link href="/admin/inventory/receipts" className="text-blue-600 hover:text-blue-700">
            ← Приходы
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900">Приход {receipt.invoiceNumber || receipt.id.slice(0, 8)}</h1>
        </div>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
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

        {/* Header info */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-zinc-900">Основная информация</h2>
                {getStatusBadge(receipt.status)}
              </div>
            </div>
            {!editMode && canModify() && (
              <button
                onClick={() => setEditMode(true)}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                ✏️ {canCorrect() ? "Корректировать" : "Редактировать"}
              </button>
            )}
            {editMode && (
              <button
                onClick={() => setEditMode(false)}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                ✕ Отмена
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Поставщик</label>
              {!editMode ? (
                <p className="text-sm text-zinc-900">{receipt.supplier?.name || "—"}</p>
              ) : (
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
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">№ накладной</label>
              {!editMode ? (
                <p className="text-sm text-zinc-900">{receipt.invoiceNumber || "—"}</p>
              ) : (
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Дата прихода</label>
              {!editMode ? (
                <p className="text-sm text-zinc-900">{formatDate(receipt.receivedAt)}</p>
              ) : (
                <input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Примечания</label>
              {!editMode ? (
                <p className="text-sm text-zinc-500 truncate">{notes || "—"}</p>
              ) : (
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          </div>
        </div>

        {/* Items section */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-900 mb-4">Позиции</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Ед. изм.</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Кол-во</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Цена за ед. (₽)</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Сумма (₽)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((item, idx) => {
                  const sku = getSkuName(item.skuId);
                  const total = (item.quantity * (item.costPerUnit || 0)).toFixed(2);
                  return (
                    <tr key={idx}>
                      <td className="px-4 py-3 text-zinc-900">
                        {!editMode ? (
                          sku?.name || item.skuId
                        ) : (
                          <select
                            value={item.skuId}
                            onChange={(e) => updateItem(idx, "skuId", e.target.value)}
                            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">— Выберите товар —</option>
                            {skus.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{sku?.unit || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">
                        {!editMode ? (
                          item.quantity
                        ) : (
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value) || 0)}
                            min={1}
                            step={1}
                            className="w-24 text-right rounded-lg border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-600 tabular-nums">
                        {!editMode ? (
                          item.costPerUnit ? item.costPerUnit.toFixed(2) : "—"
                        ) : (
                          <input
                            type="number"
                            value={item.costPerUnit || ""}
                            onChange={(e) => updateItem(idx, "costPerUnit", parseFloat(e.target.value) || null)}
                            min={0}
                            step="any"
                            className="w-28 text-right rounded-lg border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-zinc-900 tabular-nums">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit / Correction form */}
        {editMode && canModify() && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-blue-900 mb-4">
              {canCorrect() ? "Форма коррекции" : "Редактирование"}
            </h3>

            {canCorrect() && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-blue-900 mb-1">Причина коррекции *</label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  maxLength={2000}
                  placeholder="Объясните, почему необходима коррекция"
                  className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={submitting}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? (canCorrect() ? "Сохраняем коррекцию..." : "Сохраняем...") : canCorrect() ? "Сохранить коррекцию" : "Сохранить"}
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="rounded-lg border border-zinc-300 bg-white px-6 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {/* Corrections history */}
        {corrections.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">Реестр исправлений</h3>

            <div className="space-y-4">
              {corrections.map((correction) => {
                const changes = getItemsChanges(correction.itemsBefore, correction.itemsAfter);
                return (
                  <details
                    key={correction.id}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 hover:border-zinc-300 transition-colors"
                  >
                    <summary className="cursor-pointer flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-zinc-900">
                          {correction.correctedByName || "Неизвестный пользователь"}{" "}
                          <span className="text-sm text-zinc-500 font-normal">({formatDateTime(correction.createdAt)})</span>
                        </p>
                        {correction.reason && (
                          <p className="text-sm text-zinc-600 mt-1">Причина: {correction.reason}</p>
                        )}
                      </div>
                      <span className="ml-4 text-sm font-medium text-blue-600">Показать изменения ▼</span>
                    </summary>

                    <div className="mt-4 border-t border-zinc-200 pt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="pb-2 font-medium text-zinc-600">Товар</th>
                            <th className="pb-2 font-medium text-zinc-600">Было</th>
                            <th className="pb-2 font-medium text-zinc-600">Стало</th>
                            <th className="pb-2 font-medium text-zinc-600">Изменение</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {changes.map((change) => {
                            const sku = skus.find((s) => s.id === change.skuId);
                            return (
                              <tr key={change.skuId}>
                                <td className="py-2 text-zinc-900">{sku?.name || change.skuId}</td>
                                <td className="py-2 text-zinc-600 tabular-nums">{change.oldQty}</td>
                                <td className="py-2 text-zinc-900 font-medium tabular-nums">{change.qty}</td>
                                <td className={`py-2 font-medium tabular-nums ${change.delta > 0 ? "text-green-700" : "text-red-700"}`}>
                                  {change.delta > 0 ? "+" : ""}{change.delta}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
