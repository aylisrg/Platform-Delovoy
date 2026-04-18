"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";

type RecurringExpense = {
  id: string;
  name: string;
  description?: string;
  category: string;
  frequency: string;
  amount: string;
  currency: string;
  startDate: string;
  nextBillingDate: string;
  isActive: boolean;
  createdAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  IT_INFRASTRUCTURE: "IT-инфраструктура",
  ADVERTISING: "Реклама",
  TELEPHONY: "Телефония и SMS",
  OPERATIONS: "Операционные расходы",
};

const CATEGORY_COLORS: Record<string, string> = {
  IT_INFRASTRUCTURE: "bg-blue-100 text-blue-700",
  ADVERTISING: "bg-purple-100 text-purple-700",
  TELEPHONY: "bg-green-100 text-green-700",
  OPERATIONS: "bg-amber-100 text-amber-700",
};

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: "Ежемесячно",
  QUARTERLY: "Ежеквартально",
  YEARLY: "Ежегодно",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function formatMoney(amount: string | number) {
  return Number(amount).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ₽";
}

export default function RecurringPage() {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("IT_INFRASTRUCTURE");
  const [formFrequency, setFormFrequency] = useState("MONTHLY");
  const [formAmount, setFormAmount] = useState("");
  const [formStartDate, setFormStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [formNextBilling, setFormNextBilling] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/management/recurring");
      const data = await res.json();
      if (data.success) setItems(data.data);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  function resetForm() {
    setFormName("");
    setFormCategory("IT_INFRASTRUCTURE");
    setFormFrequency("MONTHLY");
    setFormAmount("");
    setFormStartDate(new Date().toISOString().split("T")[0]);
    setFormNextBilling("");
    setFormDescription("");
    setEditingId(null);
  }

  function openEdit(item: RecurringExpense) {
    setEditingId(item.id);
    setFormName(item.name);
    setFormCategory(item.category);
    setFormFrequency(item.frequency);
    setFormAmount(String(Number(item.amount)));
    setFormStartDate(item.startDate.split("T")[0]);
    setFormNextBilling(item.nextBillingDate.split("T")[0]);
    setFormDescription(item.description || "");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    try {
      const body = {
        name: formName,
        category: formCategory,
        frequency: formFrequency,
        amount: Number(formAmount),
        startDate: formStartDate,
        nextBillingDate: formNextBilling || formStartDate,
        description: formDescription || undefined,
      };

      if (editingId) {
        await fetch(`/api/management/recurring/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetch("/api/management/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      setShowForm(false);
      resetForm();
      fetchItems();
    } finally {
      setFormSaving(false);
    }
  }

  async function handleToggleActive(item: RecurringExpense) {
    await fetch(`/api/management/recurring/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    fetchItems();
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить подписку? Исторические записи расходов сохранятся.")) return;
    await fetch(`/api/management/recurring/${id}`, { method: "DELETE" });
    fetchItems();
  }

  const totalMonthly = items
    .filter((i) => i.isActive)
    .reduce((sum, i) => {
      const amount = Number(i.amount);
      switch (i.frequency) {
        case "MONTHLY": return sum + amount;
        case "QUARTERLY": return sum + amount / 3;
        case "YEARLY": return sum + amount / 12;
        default: return sum;
      }
    }, 0);

  return (
    <>
      <AdminHeader
        title="Подписки (recurring)"
        actions={
          <Link
            href="/admin/management"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Назад к расходам
          </Link>
        }
      />

      <div className="p-4 lg:p-8 space-y-6">
        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">Активных подписок</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {items.filter((i) => i.isActive).length}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-500">Среднемесячные расходы</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">{formatMoney(totalMonthly)}</p>
            <p className="mt-1 text-xs text-zinc-400">по активным подпискам</p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between border-b border-zinc-100 p-4">
            <h2 className="text-sm font-semibold text-zinc-700">Все подписки</h2>
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
            >
              + Добавить подписку
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-zinc-400 text-sm">Загрузка...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-zinc-400 text-sm">Нет подписок</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-zinc-500">
                    <th className="px-4 py-2 font-medium">Название</th>
                    <th className="px-4 py-2 font-medium">Категория</th>
                    <th className="px-4 py-2 font-medium">Период</th>
                    <th className="px-4 py-2 font-medium text-right">Сумма</th>
                    <th className="px-4 py-2 font-medium">След. списание</th>
                    <th className="px-4 py-2 font-medium">Статус</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-50 hover:bg-zinc-50">
                      <td className="px-4 py-2.5">
                        <div className="text-zinc-900 font-medium">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-zinc-400 truncate max-w-xs">{item.description}</div>
                        )}
                        {Number(item.amount) === 0 && (
                          <span className="text-xs text-amber-600 font-medium">Укажите сумму</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[item.category] || ""}`}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {FREQUENCY_LABELS[item.frequency] || item.frequency}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-zinc-900">
                        {formatMoney(item.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">{formatDate(item.nextBillingDate)}</td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => handleToggleActive(item)}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                            item.isActive
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                          }`}
                        >
                          {item.isActive ? "Активна" : "Приостановлена"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => openEdit(item)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Изменить
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            Удалить
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

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-zinc-900 mb-4">
              {editingId ? "Редактировать подписку" : "Новая подписка"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Название</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={200}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="Timeweb VPS"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Категория</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Периодичность</label>
                  <select
                    value={formFrequency}
                    onChange={(e) => setFormFrequency(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  >
                    {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Сумма (₽)</label>
                <input
                  type="number"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  required
                  min={0}
                  step="0.01"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  placeholder="3500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Дата начала</label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">След. списание</label>
                  <input
                    type="date"
                    value={formNextBilling}
                    onChange={(e) => setFormNextBilling(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Описание (необязательно)</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {formSaving ? "Сохранение..." : editingId ? "Обновить" : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
