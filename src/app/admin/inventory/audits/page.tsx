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

const AUDIT_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "Идёт",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};

const AUDIT_STATUS_VARIANTS: Record<string, string> = {
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-zinc-100 text-zinc-600",
};

type AuditCount = {
  skuId: string;
  actualQty: number;
  systemQty: number;
  sku: { id: string; name: string; unit: string };
};

type AuditDetail = {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  counts: AuditCount[];
};

type AuditListItem = {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  counts: Array<{ id: string }>;
};

type SkuOption = {
  id: string;
  name: string;
  category: string;
  unit: string;
  stockQuantity: number;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function DeltaCell({ system, actual }: { system: number; actual: number }) {
  const delta = actual - system;
  if (delta === 0) return <span className="text-green-700 font-semibold tabular-nums">0</span>;
  if (delta < 0)
    return (
      <span className="text-red-700 font-semibold tabular-nums">
        {delta}
      </span>
    );
  return (
    <span className="text-orange-600 font-semibold tabular-nums">
      +{delta}
    </span>
  );
}

export default function AuditsPage() {
  const router = useRouter();
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [activeAudit, setActiveAudit] = useState<AuditDetail | null>(null);
  const [skus, setSkus] = useState<SkuOption[]>([]);

  const [listLoading, setListLoading] = useState(true);
  const [startLoading, setStartLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [savingCounts, setSavingCounts] = useState(false);

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newAuditNotes, setNewAuditNotes] = useState("");

  const loadAudits = useCallback(() => {
    setListLoading(true);
    fetch("/api/inventory/audits")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: AuditListItem[] }) => {
        if (json.success && json.data) setAudits(json.data);
      })
      .catch(() => undefined)
      .finally(() => setListLoading(false));
  }, []);

  const loadActiveAudit = useCallback(() => {
    fetch("/api/inventory/audits")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: AuditListItem[] }) => {
        if (!json.success || !json.data) return;
        const inProgress = json.data.find((a) => a.status === "IN_PROGRESS");
        if (!inProgress) {
          setActiveAudit(null);
          return;
        }
        return fetch(`/api/inventory/audits/${inProgress.id}`)
          .then((r) => r.json())
          .then((detail: { success: boolean; data?: AuditDetail }) => {
            if (detail.success && detail.data) {
              setActiveAudit(detail.data);
              // Initialize counts from existing data
              const initial: Record<string, string> = {};
              detail.data.counts.forEach((c) => {
                initial[c.skuId] = String(c.actualQty);
              });
              setCounts(initial);
            }
          });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/inventory/sku")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SkuOption[] }) => {
        if (json.success && json.data) setSkus(json.data);
      })
      .catch(() => undefined);

    loadAudits();
    loadActiveAudit();
  }, [loadAudits, loadActiveAudit]);

  async function handleStartAudit() {
    setBanner(null);
    setStartLoading(true);
    try {
      const res = await fetch("/api/inventory/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: newAuditNotes.trim() || undefined }),
      });
      const json = await res.json() as { success: boolean; data?: AuditDetail; error?: { message?: string } };
      if (json.success) {
        setBanner({ type: "success", text: "Инвентаризация начата" });
        setNewAuditNotes("");
        loadAudits();
        loadActiveAudit();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setStartLoading(false);
    }
  }

  async function handleSaveCounts() {
    if (!activeAudit) return;
    setBanner(null);
    setSavingCounts(true);

    const countsList = skus
      .filter((s) => s.stockQuantity > 0 || counts[s.id] !== undefined)
      .map((s) => ({
        skuId: s.id,
        actualQty: parseFloat(counts[s.id] ?? String(s.stockQuantity)) || 0,
      }));

    try {
      const res = await fetch(`/api/inventory/audits/${activeAudit.id}/counts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts: countsList }),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };
      if (json.success) {
        setBanner({ type: "success", text: "Данные сохранены" });
        loadActiveAudit();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setSavingCounts(false);
    }
  }

  async function handleSubmit() {
    if (!activeAudit) return;
    if (!confirm("Завершить инвентаризацию? Это действие необратимо.")) return;
    setBanner(null);
    setSubmitLoading(true);

    try {
      const res = await fetch(`/api/inventory/audits/${activeAudit.id}/submit`, {
        method: "POST",
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };
      if (json.success) {
        setBanner({ type: "success", text: "Инвентаризация завершена" });
        setActiveAudit(null);
        setCounts({});
        loadAudits();
        router.refresh();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setSubmitLoading(false);
    }
  }

  const hasActiveAudit = activeAudit !== null;
  const activeSkus = skus.filter((s) => s.stockQuantity > 0);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
        <h1 className="text-xl font-semibold text-zinc-900">Склад — Инвентаризация</h1>
        {!hasActiveAudit && (
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newAuditNotes}
              onChange={(e) => setNewAuditNotes(e.target.value)}
              placeholder="Примечание (необязательно)"
              className="w-56 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleStartAudit}
              disabled={startLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {startLoading ? "Начинаем..." : "Начать инвентаризацию"}
            </button>
          </div>
        )}
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/audits"
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

        {/* Active audit count form */}
        {hasActiveAudit && (
          <div className="rounded-xl border border-blue-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-100 bg-blue-50/40">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  Инвентаризация в процессе
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Начата {formatDate(activeAudit!.createdAt)}
                  {activeAudit!.notes ? ` · ${activeAudit!.notes}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveCounts}
                  disabled={savingCounts || submitLoading}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                >
                  {savingCounts ? "Сохраняем..." : "Сохранить подсчёты"}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitLoading || savingCounts}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {submitLoading ? "Завершаем..." : "Завершить инвентаризацию"}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Товар</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Ед. изм.</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">
                      По системе
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">
                      Фактически
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">
                      Расхождение
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {activeSkus.map((sku) => {
                    const actualStr = counts[sku.id] ?? String(sku.stockQuantity);
                    const actual = parseFloat(actualStr) || 0;
                    return (
                      <tr key={sku.id} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 font-medium text-zinc-900">{sku.name}</td>
                        <td className="px-4 py-3 text-zinc-500">{sku.unit}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                          {sku.stockQuantity}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            value={actualStr}
                            onChange={(e) =>
                              setCounts((prev) => ({ ...prev, [sku.id]: e.target.value }))
                            }
                            min={0}
                            step="any"
                            className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm text-right outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DeltaCell system={sku.stockQuantity} actual={actual} />
                        </td>
                      </tr>
                    );
                  })}
                  {activeSkus.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">
                        Нет активных товаров для инвентаризации
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Audits history list */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-base font-semibold text-zinc-900">История инвентаризаций</h2>
          </div>

          {listLoading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-zinc-100" />
              ))}
            </div>
          ) : audits.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-400">
              Инвентаризаций пока не проводилось
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Дата</th>
                    <th className="px-4 py-3 text-center font-medium text-zinc-500">Статус</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Позиций</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Примечания</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {audits.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 text-zinc-700 whitespace-nowrap">
                        {formatDate(a.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            AUDIT_STATUS_VARIANTS[a.status] ?? "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {AUDIT_STATUS_LABELS[a.status] ?? a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                        {a.counts.length}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{a.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
