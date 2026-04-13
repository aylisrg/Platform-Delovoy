"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Contract = {
  id: string;
  startDate: string;
  endDate: string;
  pricePerSqm: number | null;
  monthlyRate: number;
  currency: string;
  newPricePerSqm: number | null;
  priceIncreaseDate: string | null;
  deposit: number | null;
  contractNumber: string | null;
  status: string;
  notes: string | null;
  tenant: { companyName: string };
  office: { number: string; floor: number; building: number };
};

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().split("T")[0];
}

export function ContractEditModal({
  contract,
  open,
  onClose,
}: {
  contract: Contract;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    startDate: toDateInput(contract.startDate),
    endDate: toDateInput(contract.endDate),
    pricePerSqm: contract.pricePerSqm ?? "",
    monthlyRate: contract.monthlyRate,
    currency: contract.currency,
    newPricePerSqm: contract.newPricePerSqm ?? "",
    priceIncreaseDate: toDateInput(contract.priceIncreaseDate ?? null),
    deposit: contract.deposit ?? "",
    contractNumber: contract.contractNumber ?? "",
    notes: contract.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const isTerminal = contract.status === "EXPIRED" || contract.status === "TERMINATED";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {};

    if (form.startDate !== toDateInput(contract.startDate)) body.startDate = form.startDate;
    if (form.endDate !== toDateInput(contract.endDate)) body.endDate = form.endDate;
    if (form.pricePerSqm !== "" && Number(form.pricePerSqm) !== contract.pricePerSqm) body.pricePerSqm = Number(form.pricePerSqm);
    if (form.monthlyRate !== contract.monthlyRate) body.monthlyRate = form.monthlyRate;
    if (form.currency !== contract.currency) body.currency = form.currency;
    if (form.newPricePerSqm !== "" && Number(form.newPricePerSqm) !== contract.newPricePerSqm) body.newPricePerSqm = Number(form.newPricePerSqm);
    if (form.priceIncreaseDate && form.priceIncreaseDate !== toDateInput(contract.priceIncreaseDate ?? null)) body.priceIncreaseDate = form.priceIncreaseDate;
    if (form.deposit !== "" && Number(form.deposit) !== contract.deposit) body.deposit = Number(form.deposit);
    if (form.contractNumber !== (contract.contractNumber ?? "")) body.contractNumber = form.contractNumber || undefined;
    if (form.notes !== (contract.notes ?? "")) body.notes = form.notes || undefined;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/rental/contracts/${contract.id}`, {
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
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-zinc-900">Редактировать договор</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">
            ✕
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          {contract.tenant.companyName} — К{contract.office.building}·{contract.office.number}
        </p>

        {isTerminal && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            Договор завершён. Редактирование ограничено заметками и номером.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Номер договора</label>
            <input
              type="text"
              value={form.contractNumber}
              onChange={(e) => setForm((f) => ({ ...f, contractNumber: e.target.value }))}
              placeholder="Д-2025/001"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Дата начала</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                disabled={isTerminal}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Дата окончания</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                disabled={isTerminal}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 space-y-3">
            <p className="text-xs font-semibold text-blue-800">Финансы</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Ставка за м² (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={form.pricePerSqm}
                  onChange={(e) => setForm((f) => ({ ...f, pricePerSqm: e.target.value === "" ? "" : Number(e.target.value) }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Сумма/мес (₽) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="100"
                  value={form.monthlyRate}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyRate: Number(e.target.value) }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Депозит (₽)</label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={form.deposit}
                  onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value === "" ? "" : Number(e.target.value) }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Валюта</label>
                <input
                  type="text"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 space-y-3">
            <p className="text-xs font-semibold text-amber-800">Повышение ставки</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Новая ставка/м²</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={form.newPricePerSqm}
                  onChange={(e) => setForm((f) => ({ ...f, newPricePerSqm: e.target.value === "" ? "" : Number(e.target.value) }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Дата повышения</label>
                <input
                  type="date"
                  value={form.priceIncreaseDate}
                  onChange={(e) => setForm((f) => ({ ...f, priceIncreaseDate: e.target.value }))}
                  disabled={isTerminal}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-zinc-50"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Заметки</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
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
