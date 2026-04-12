"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupplierSummary } from "@/modules/inventory/types";

type Props = {
  initialSuppliers: SupplierSummary[];
};

type FormErrors = Record<string, string>;

const EMPTY_FORM = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  inn: "",
  notes: "",
};

function SupplierForm({
  initial,
  onSuccess,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_FORM> & { id?: string };
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const isEdit = Boolean(initial?.id);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.name.trim()) errs.name = "Название обязательно";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = "Некорректный e-mail";
    return errs;
  }

  function set(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
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
      const url = isEdit
        ? `/api/inventory/suppliers/${initial!.id}`
        : "/api/inventory/suppliers";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, string> = {};
      if (form.name.trim()) body.name = form.name.trim();
      if (form.contactName.trim()) body.contactName = form.contactName.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.inn.trim()) body.inn = form.inn.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };

      if (json.success) {
        onSuccess();
      } else {
        setBanner(json.error?.message ?? "Ошибка при сохранении");
      }
    } catch {
      setBanner("Ошибка сети");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = (field: string) =>
    `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
      errors[field] ? "border-red-400 bg-red-50" : "border-zinc-300"
    }`;

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-5 space-y-4">
      <h3 className="text-base font-semibold text-zinc-900">
        {isEdit ? "Редактировать поставщика" : "Новый поставщик"}
      </h3>

      {banner && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {banner}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={set("name")}
            maxLength={200}
            className={inputCls("name")}
          />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Контактное лицо</label>
            <input
              type="text"
              value={form.contactName}
              onChange={set("contactName")}
              maxLength={200}
              className={inputCls("contactName")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Телефон</label>
            <input
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              maxLength={20}
              className={inputCls("phone")}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              maxLength={200}
              className={inputCls("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">ИНН</label>
            <input
              type="text"
              value={form.inn}
              onChange={set("inn")}
              maxLength={12}
              className={inputCls("inn")}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Примечания</label>
          <textarea
            value={form.notes}
            onChange={set("notes")}
            maxLength={1000}
            rows={2}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Сохраняем..." : isEdit ? "Сохранить" : "Добавить"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}

export function SuppliersList({ initialSuppliers }: Props) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filtered = suppliers.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.contactName ?? "").toLowerCase().includes(q) ||
      (s.phone ?? "").includes(q)
    );
  });

  function handleSuccess() {
    setShowForm(false);
    setEditId(null);
    setBanner({ type: "success", text: "Поставщик сохранён" });
    router.refresh();
    // Reload list
    fetch("/api/inventory/suppliers")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: SupplierSummary[] }) => {
        if (json.success && json.data) setSuppliers(json.data);
      })
      .catch(() => undefined);
  }

  async function handleDeactivate(id: string, isActive: boolean) {
    setActionLoading(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/inventory/suppliers/${id}`, {
        method: isActive ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: isActive ? undefined : JSON.stringify({ isActive: true }),
      });
      const json = await res.json() as { success: boolean; error?: { message?: string } };
      if (json.success) {
        setBanner({ type: "success", text: isActive ? "Поставщик деактивирован" : "Поставщик активирован" });
        setSuppliers((prev) =>
          prev.map((s) => (s.id === id ? { ...s, isActive: !isActive } : s))
        );
        router.refresh();
      } else {
        setBanner({ type: "error", text: json.error?.message ?? "Ошибка" });
      }
    } catch {
      setBanner({ type: "error", text: "Ошибка сети" });
    } finally {
      setActionLoading(null);
    }
  }

  const editingSupplier = editId ? suppliers.find((s) => s.id === editId) : null;

  return (
    <div className="space-y-4">
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию, контакту..."
          className="w-full sm:w-72 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        {!showForm && !editId && (
          <button
            onClick={() => setShowForm(true)}
            className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            + Добавить поставщика
          </button>
        )}
      </div>

      {showForm && !editId && (
        <SupplierForm onSuccess={handleSuccess} onCancel={() => setShowForm(false)} />
      )}

      {editingSupplier && (
        <SupplierForm
          initial={{
            id: editingSupplier.id,
            name: editingSupplier.name,
            contactName: editingSupplier.contactName ?? "",
            phone: editingSupplier.phone ?? "",
            email: "",
          }}
          onSuccess={handleSuccess}
          onCancel={() => setEditId(null)}
        />
      )}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-base font-semibold text-zinc-900">Список поставщиков</h2>
          <span className="text-sm text-zinc-400">{filtered.length}</span>
        </div>

        {filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-zinc-400">
            {search ? "Ничего не найдено" : "Поставщиков пока нет"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Название</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Контакт</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500">Телефон</th>
                  <th className="px-4 py-3 text-center font-medium text-zinc-500">Статус</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((s) => (
                  <tr key={s.id} className={`hover:bg-zinc-50 ${!s.isActive ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 font-medium text-zinc-900">{s.name}</td>
                    <td className="px-4 py-3 text-zinc-600">{s.contactName ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-600">{s.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          s.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {s.isActive ? "Активен" : "Неактивен"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditId(s.id)}
                          disabled={actionLoading === s.id}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                        >
                          Изменить
                        </button>
                        <button
                          onClick={() => handleDeactivate(s.id, s.isActive)}
                          disabled={actionLoading === s.id}
                          className={`text-xs hover:underline disabled:opacity-50 ${
                            s.isActive ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          {actionLoading === s.id
                            ? "..."
                            : s.isActive
                            ? "Деактивировать"
                            : "Активировать"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
