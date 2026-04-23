"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatDate as formatDateUnified } from "@/lib/format";

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
  stockQuantity: number;
};

type WriteOffRow = {
  id: string;
  createdAt: string;
  quantity: number;
  reason: string;
  note: string | null;
  sku: { id: string; name: string; unit: string };
  performedBy?: { name: string | null } | null;
};

const REASON_LABELS: Record<string, string> = {
  EXPIRED: "Истёк срок",
  DAMAGED: "Повреждён",
  LOST: "Утеря",
  OTHER: "Другое",
};

function formatDate(iso: string) {
  return formatDateUnified(iso);
}

export default function WriteOffsPage() {
  const router = useRouter();
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [writeOffs, setWriteOffs] = useState<WriteOffRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Form state
  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("EXPIRED");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [expiredLoading, setExpiredLoading] = useState(false);
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
  }, []);

  const loadHistory = useCallback(
    (p: number) => {
      setHistoryLoading(true);
      fetch(`/api/inventory/write-offs?page=${p}&perPage=${perPage}`)
        .then((r) => r.json())
        .then(
          (json: {
            success: boolean;
            data?: WriteOffRow[];
            meta?: { total: number; perPage: number };
          }) => {
            if (json.success && json.data) {
              setWriteOffs(json.data);
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

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!skuId) errs.skuId = "Выберите товар";
    const qty = parseFloat(quantity);
    if (!quantity || isNaN(qty) || qty <= 0) errs.quantity = "Введите количество > 0";
    if (reason === "OTHER" && !note.trim()) errs.note = "Укажите причину для категории «Другое»";
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
      const res = await fetch("/api/inventory/write-offs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          quantity: parseFloat(quantity),
          reason,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };

      if (json.success) {
        setBanner({ type: "success", text: "Списание записано" });
        setSkuId("");
        setQuantity("");
        setReason("EXPIRED");
        setNote("");
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

  async function handleWriteOffExpired() {
    setBanner(null);
    setExpiredLoading(true);
    try {
      const res = await fetch("/api/inventory/write-offs/expired", { method: "POST" });
      const json = await res.json() as {
        success: boolean;
        data?: { count: number };
        error?: { message?: string };
      };
      if (json.success) {
        const count = json.data?.count ?? 0;
        setBanner({
          type: "success",
          text:
            count > 0
              ? `Списано ${count} просроченных партий`
              : "Просроченных партий не найдено",
        });
        loadHistory(1);
        setPage(1);
        router.refresh();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setExpiredLoading(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
      errors[field] ? "border-red-400 bg-red-50" : "border-zinc-300"
    }`;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Списания</h1>
        <button
          onClick={handleWriteOffExpired}
          disabled={expiredLoading}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {expiredLoading ? "Списываем..." : "Списать все просроченные"}
        </button>
      </header>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/write-offs"
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

        {/* Write-off form */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-zinc-900">Форма списания</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Товар <span className="text-red-500">*</span>
                </label>
                <select
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  className={inputCls("skuId")}
                >
                  <option value="">— Выберите товар —</option>
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.unit}) — {s.stockQuantity} в наличии
                    </option>
                  ))}
                </select>
                {errors.skuId && <p className="mt-1 text-xs text-red-600">{errors.skuId}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Количество <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  min={0.001}
                  step="any"
                  placeholder="0"
                  className={inputCls("quantity")}
                />
                {errors.quantity && (
                  <p className="mt-1 text-xs text-red-600">{errors.quantity}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Причина <span className="text-red-500">*</span>
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={inputCls("reason")}
                >
                  <option value="EXPIRED">Истёк срок годности</option>
                  <option value="DAMAGED">Повреждён</option>
                  <option value="LOST">Утеря</option>
                  <option value="OTHER">Другое</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Примечание{" "}
                  {reason === "OTHER" && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  placeholder={
                    reason === "OTHER" ? "Обязательно при выборе «Другое»" : "Необязательно"
                  }
                  className={inputCls("note")}
                />
                {errors.note && <p className="mt-1 text-xs text-red-600">{errors.note}</p>}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Записываем..." : "Списать"}
            </button>
          </form>
        </div>

        {/* History */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">История списаний</h2>
          </div>

          {historyLoading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : writeOffs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">Списаний пока нет</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Дата</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-500">Кол-во</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Причина</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Примечание</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-500">Сотрудник</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {writeOffs.map((wo) => (
                      <tr key={wo.id} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                          {formatDate(wo.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium text-zinc-900">{wo.sku.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-700 font-semibold">
                          −{wo.quantity} {wo.sku.unit}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                            {REASON_LABELS[wo.reason] ?? wo.reason}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 max-w-xs truncate">
                          {wo.note ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-zinc-500">
                          {wo.performedBy?.name ?? "—"}
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
