"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Tenant = {
  id: string;
  companyName: string;
  tenantType: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
  legalAddress: string | null;
  needsLegalAddress: boolean;
  notes: string | null;
};

export function TenantEditModal({
  tenant,
  open,
  onClose,
}: {
  tenant: Tenant;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...tenant });
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
    if (form.companyName !== tenant.companyName) body.companyName = form.companyName;
    if (form.tenantType !== tenant.tenantType) body.tenantType = form.tenantType;
    if (form.contactName !== tenant.contactName) body.contactName = form.contactName || undefined;
    if (form.phone !== tenant.phone) body.phone = form.phone || undefined;
    if (form.email !== tenant.email) body.email = form.email || undefined;
    if (form.inn !== tenant.inn) body.inn = form.inn || undefined;
    if (form.legalAddress !== tenant.legalAddress) body.legalAddress = form.legalAddress || undefined;
    if (form.needsLegalAddress !== tenant.needsLegalAddress) body.needsLegalAddress = form.needsLegalAddress;
    if (form.notes !== tenant.notes) body.notes = form.notes || undefined;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      const res = await fetch(`/api/rental/tenants/${tenant.id}`, {
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
          <h2 className="text-base font-semibold text-zinc-900">Редактировать арендатора</h2>
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
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Название / ФИО *</label>
            <input
              type="text"
              required
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Тип арендатора</label>
            <select
              value={form.tenantType}
              onChange={(e) => set("tenantType", e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="COMPANY">ООО / АО / ЗАО</option>
              <option value="IP">ИП</option>
              <option value="INDIVIDUAL">Физлицо</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Контактное лицо</label>
              <input
                type="text"
                value={form.contactName ?? ""}
                onChange={(e) => set("contactName", e.target.value || null)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Телефон</label>
              <input
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value || null)}
                placeholder="79XXXXXXXXX"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Email</label>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value || null)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">ИНН</label>
              <input
                type="text"
                value={form.inn ?? ""}
                onChange={(e) => set("inn", e.target.value || null)}
                placeholder="10 или 12 цифр"
                maxLength={12}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Юридический адрес</label>
            <input
              type="text"
              value={form.legalAddress ?? ""}
              onChange={(e) => set("legalAddress", e.target.value || null)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="needsLegal"
              type="checkbox"
              checked={form.needsLegalAddress}
              onChange={(e) => set("needsLegalAddress", e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="needsLegal" className="text-sm text-zinc-700">
              Нужен юр. адрес БП
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Заметки</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
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
