"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DeleteConfirmDialog, deleteWithPassword } from "@/components/admin/shared/delete-confirm-dialog";

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

type Receipt = {
  id: string;
  status: "DRAFT" | "CONFIRMED" | "PROBLEM" | "CORRECTED";
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  invoiceNumber: string | null;
  receivedAt: string;
  notes: string | null;
  performedById: string;
  performedBy: { id: string; name: string | null } | null;
  items: Array<{
    id: string;
    skuId: string;
    sku: { name: string; category: string; unit: string };
    quantity: number;
    costPerUnit: number | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

type Correction = {
  id: string;
  receiptId: string;
  correctorId: string;
  corrector: { id: string; name: string | null } | null;
  itemsBefore: Array<{ skuId: string; quantity: number; costPerUnit?: number }>;
  itemsAfter: Array<{ skuId: string; quantity: number; costPerUnit?: number }>;
  reason: string | null;
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

type EditItem = {
  skuId: string;
  quantity: string;
  costPerUnit: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadge(status: string) {
  const badges: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-zinc-100", text: "text-zinc-800", label: "Черновик" },
    CONFIRMED: { bg: "bg-green-100", text: "text-green-800", label: "Подтверждён" },
    PROBLEM: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Проблема" },
    CORRECTED: { bg: "bg-blue-100", text: "text-blue-800", label: "Исправлен" },
  };
  const badge = badges[status] || badges.DRAFT;
  return <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>{badge.label}</span>;
}

export default function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [receiptId, setReceiptId] = useState<string>("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [expandedCorrection, setExpandedCorrection] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EditItem[]>([]);
  const [correctionReason, setCorrectionReason] = useState("");

  useEffect(() => {
    params.then(({ id }) => setReceiptId(id));
  }, [params]);

  useEffect(() => {
    if (!receiptId) return;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetch(`/api/inventory/receipts-v2/${receiptId}`).then((r) => r.json()),
      fetch(`/api/inventory/receipts-v2/${receiptId}/corrections`).then((r) => r.json()),
      fetch("/api/inventory/sku").then((r) => r.json()),
      fetch("/api/inventory/suppliers?isActive=true").then((r) => r.json()),
    ])
      .then(([recRes, corrRes, skuRes, suppRes]) => {
        if (recRes.success && recRes.data) {
          setReceipt(recRes.data);
          setSupplierId(recRes.data.supplierId || "");
          setInvoiceNumber(recRes.data.invoiceNumber || "");
          setReceivedAt(recRes.data.receivedAt);
          setNotes(recRes.data.notes || "");
          setItems(
            recRes.data.items.map((it: Receipt["items"][number]) => ({
              skuId: it.skuId,
              quantity: it.quantity.toString(),
              costPerUnit: it.costPerUnit?.toString() || "",
            }))
          );
        } else {
          setLoadError(recRes?.error?.message || "Не удалось загрузить приход — возможно, нет доступа или приход удалён");
        }
        if (corrRes.success && corrRes.data) setCorrections(corrRes.data);
        if (skuRes.success && skuRes.data) setSkus(skuRes.data);
        if (suppRes.success && suppRes.data) setSuppliers(suppRes.data);
      })
      .catch(() => setLoadError("Ошибка сети при загрузке прихода"))
      .finally(() => setLoading(false));
  }, [receiptId]);

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
          <h1 className="text-xl font-semibold text-zinc-900">Приход</h1>
        </header>
        <div className="p-6">
          <p className="text-zinc-600">Требуется авторизация</p>
        </div>
      </div>
    );
  }

  const role = session.user.role as string;
  const isAdminLike = role === "ADMIN" || role === "SUPERADMIN";
  const canEdit = !!receipt && isAdminLike && (receipt.status === "DRAFT" || receipt.status === "PROBLEM");
  const canCorrect = !!receipt && isAdminLike && (receipt.status === "CONFIRMED" || receipt.status === "CORRECTED");
  const canModify = canEdit || canCorrect;
  const canDelete = !!receipt && role === "SUPERADMIN";
  const showCorrections = isAdminLike || (role === "MANAGER" && receipt?.performedById === session.user.id);

  async function handleSave() {
    if (!receipt) return;
    setSaving(true);
    setBanner(null);

    try {
      const body = {
        supplierId: supplierId || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        receivedAt,
        notes: notes.trim() || undefined,
        items: items
          .filter((it) => it.skuId)
          .map((it) => ({
            skuId: it.skuId,
            quantity: parseFloat(it.quantity),
            costPerUnit: it.costPerUnit ? parseFloat(it.costPerUnit) : undefined,
          })),
        correctionReason: canCorrect && correctionReason.trim() ? correctionReason.trim() : undefined,
      };

      const res = await fetch(`/api/inventory/receipts-v2/${receipt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as { success: boolean; error?: { message: string } };

      if (json.success) {
        setBanner({ type: "success", text: canEdit ? "Приход обновлён" : "Исправление сохранено" });
        const [recRes, corrRes] = await Promise.all([
          fetch(`/api/inventory/receipts-v2/${receipt.id}`).then((r) => r.json()),
          fetch(`/api/inventory/receipts-v2/${receipt.id}/corrections`).then((r) => r.json()),
        ]);
        if (recRes.success && recRes.data) {
          setReceipt(recRes.data);
          setItems(
            recRes.data.items.map((it: Receipt["items"][number]) => ({
              skuId: it.skuId,
              quantity: it.quantity.toString(),
              costPerUnit: it.costPerUnit?.toString() || "",
            }))
          );
          setSupplierId(recRes.data.supplierId || "");
          setInvoiceNumber(recRes.data.invoiceNumber || "");
          setReceivedAt(recRes.data.receivedAt);
          setNotes(recRes.data.notes || "");
        }
        if (corrRes.success && corrRes.data) setCorrections(corrRes.data);
        setCorrectionReason("");
      } else {
        setBanner({ type: "error", text: json.error?.message || "Ошибка при сохранении" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setSaving(false);
    }
  }

  function updateItem(index: number, field: string, value: string) {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { skuId: "", quantity: "", costPerUnit: "" }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
          <h1 className="text-xl font-semibold text-zinc-900">Приход</h1>
        </header>
        <div className="p-6 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/inventory/receipts" className="text-blue-600 hover:text-blue-700">← Назад</Link>
            <h1 className="text-xl font-semibold text-zinc-900">Приход</h1>
          </div>
        </header>
        <div className="p-6 max-w-3xl mx-auto">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError ?? "Приход не найден"}
          </div>
        </div>
      </div>
    );
  }

  async function handleDelete(password: string, reason: string | null): Promise<string | null> {
    if (!receipt) return "Приход не найден";
    const err = await deleteWithPassword(`/api/inventory/receipts-v2/${receipt.id}`, password, reason);
    if (err) return err;
    setDeleteOpen(false);
    router.push("/admin/inventory/receipts");
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <div className="flex items-center gap-4">
          <Link href="/admin/inventory/receipts" className="text-blue-600 hover:text-blue-700">
            ← Назад
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900">Приход {receipt.invoiceNumber && `№${receipt.invoiceNumber}`}</h1>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Удалить приход
          </button>
        )}
      </header>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/receipts" ? "text-blue-600 border-blue-600" : "text-zinc-500 border-transparent hover:text-zinc-900"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {banner && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              banner.type === "success" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-zinc-500">Статус</p>
              <div className="mt-1">{getStatusBadge(receipt.status)}</div>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Поставщик</p>
              <p className="text-sm text-zinc-900">{receipt.supplier?.name || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">№ накладной</p>
              <p className="text-sm text-zinc-900">{receipt.invoiceNumber || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Дата прихода</p>
              <p className="text-sm text-zinc-900">{new Date(receipt.receivedAt).toLocaleDateString("ru-RU")}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Ответственный</p>
              <p className="text-sm text-zinc-900">{receipt.performedBy?.name || "—"}</p>
            </div>
            {receipt.notes && (
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-zinc-500">Примечания</p>
                <p className="text-sm text-zinc-900">{receipt.notes}</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-zinc-900">Товары</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Товар</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-500">Кол-во</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-500">Цена/шт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {receipt.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-3 text-zinc-900">{it.sku.name}</td>
                    <td className="px-4 py-3 text-right text-zinc-900 tabular-nums">{it.quantity} {it.sku.unit}</td>
                    <td className="px-4 py-3 text-right text-zinc-600 tabular-nums">{it.costPerUnit != null ? Number(it.costPerUnit).toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canModify && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-zinc-900">{canEdit ? "Редактировать приход" : "Исправление подтверждённого прихода"}</h2>
            {canEdit && (
              <p className="mb-4 text-xs text-zinc-500">
                Приход в статусе {receipt.status}. Изменения сохранятся напрямую и попадут в журнал аудита.
              </p>
            )}

            <form className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Поставщик</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Без поставщика —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">№ накладной</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Дата</label>
                  <input
                    type="date"
                    value={receivedAt.slice(0, 10)}
                    onChange={(e) => setReceivedAt(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Примечания</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={1000}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-3">Товары</label>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200">
                        <th className="px-3 py-2 text-left font-medium text-zinc-500">Товар</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-500">Кол-во</th>
                        <th className="px-3 py-2 text-right font-medium text-zinc-500">Цена/шт</th>
                        <th className="px-3 py-2 text-center font-medium text-zinc-500">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">
                            <select
                              value={item.skuId}
                              onChange={(e) => updateItem(i, "skuId", e.target.value)}
                              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">—</option>
                              {skus.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min="0" value={item.quantity} onChange={(e) => updateItem(i, "quantity", e.target.value)} className="w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min="0" value={item.costPerUnit} onChange={(e) => updateItem(i, "costPerUnit", e.target.value)} className="w-full rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button type="button" onClick={() => removeItem(i)} className="text-xs text-red-600 hover:text-red-700 font-medium">Удалить</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={addItem} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">+ Добавить товар</button>
              </div>

              {canCorrect && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Причина исправления</label>
                  <textarea value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Объясните, почему требуется исправление" />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "Сохранение..." : canEdit ? "Обновить" : "Исправить"}</button>
                <Link href="/admin/inventory/receipts" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Отменить</Link>
              </div>
            </form>
          </div>
        )}

        <DeleteConfirmDialog
          open={deleteOpen}
          title="Удалить приход"
          target={`Приход ${receipt.invoiceNumber ? `№${receipt.invoiceNumber}` : receipt.id.slice(0, 8)} (${receipt.items.length} поз., статус ${receipt.status})`}
          description="Будут удалены сам приход, его позиции и история исправлений. Полный снимок сохранится в журнале удалений."
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />

        {showCorrections && corrections.length > 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-zinc-900">История исправлений</h2>
            <div className="space-y-3">
              {corrections.map((corr) => (
                <div key={corr.id} className="border border-zinc-200 rounded-lg overflow-hidden">
                  <button onClick={() => setExpandedCorrection(expandedCorrection === corr.id ? null : corr.id)} className="w-full px-4 py-3 text-left hover:bg-zinc-50 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{corr.corrector?.name || "Неизвестный"}</p>
                      <p className="text-xs text-zinc-500">{formatDate(corr.createdAt)}</p>
                      {corr.reason && <p className="text-xs text-zinc-600 mt-1">{corr.reason}</p>}
                    </div>
                    <span className="text-zinc-400">{expandedCorrection === corr.id ? "▼" : "▶"}</span>
                  </button>

                  {expandedCorrection === corr.id && (
                    <div className="border-t border-zinc-200 bg-zinc-50 p-4">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-zinc-200">
                            <th className="px-3 py-2 text-left font-medium text-zinc-600">Товар</th>
                            <th className="px-3 py-2 text-right font-medium text-zinc-600">Было</th>
                            <th className="px-3 py-2 text-right font-medium text-zinc-600">Стало</th>
                            <th className="px-3 py-2 text-right font-medium text-zinc-600">Изменение</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {(() => {
                            const skuMap = new Map<string, { before?: number; after?: number }>();
                            corr.itemsBefore.forEach((it) => {
                              const entry = skuMap.get(it.skuId) || {};
                              skuMap.set(it.skuId, { ...entry, before: it.quantity });
                            });
                            corr.itemsAfter.forEach((it) => {
                              const entry = skuMap.get(it.skuId) || {};
                              skuMap.set(it.skuId, { ...entry, after: it.quantity });
                            });
                            return Array.from(skuMap.entries()).map(([skuId, { before = 0, after = 0 }]) => {
                              const sku = receipt.items.find((it) => it.skuId === skuId);
                              const delta = after - before;
                              return (
                                <tr key={skuId}>
                                  <td className="px-3 py-2 text-zinc-700">{sku?.sku.name || skuId}</td>
                                  <td className="px-3 py-2 text-right text-zinc-600 tabular-nums">{before}</td>
                                  <td className="px-3 py-2 text-right text-zinc-600 tabular-nums">{after}</td>
                                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : "text-zinc-500"}`}>{delta > 0 ? "+" : ""}{delta}</td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
