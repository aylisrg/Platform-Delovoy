"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { DealCardData } from "./deal-card";
import type { DealStage } from "@/modules/rental/types";

type OfficeOption = {
  id: string;
  number: string;
  floor: number;
  building: number;
  area: number;
  pricePerMonth: number;
  status: string;
};

type Props = {
  deal: DealCardData | null;
  stage?: DealStage;
  offices: OfficeOption[];
  onClose: () => void;
};

const stageLabels: Record<DealStage, string> = {
  NEW_LEAD: "Новая заявка",
  QUALIFICATION: "Квалификация",
  SHOWING: "Показ",
  PROPOSAL: "КП отправлено",
  NEGOTIATION: "Переговоры",
  CONTRACT_DRAFT: "Договор",
  WON: "Выиграно",
  LOST: "Проиграно",
};

const sourceOptions = [
  { value: "WEBSITE", label: "Сайт" },
  { value: "PHONE", label: "Звонок" },
  { value: "WALK_IN", label: "Визит" },
  { value: "REFERRAL", label: "Рекомендация" },
  { value: "AVITO", label: "Авито" },
  { value: "CIAN", label: "ЦИАН" },
  { value: "OTHER", label: "Другое" },
];

const priorityOptions = [
  { value: "HOT", label: "Hot — горячий" },
  { value: "WARM", label: "Warm — тёплый" },
  { value: "COLD", label: "Cold — холодный" },
];

function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  return val.slice(0, 10);
}

export function DealModal({ deal, stage, offices, onClose }: Props) {
  const router = useRouter();
  const isEdit = !!deal;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    contactName: deal?.contactName ?? "",
    phone: deal?.phone ?? "",
    email: deal?.email ?? "",
    companyName: deal?.companyName ?? "",
    stage: deal?.stage ?? stage ?? "NEW_LEAD",
    priority: deal?.priority ?? "WARM",
    source: deal?.source ?? "PHONE",
    desiredArea: deal?.desiredArea ?? "",
    budget: deal?.budget ?? "",
    moveInDate: toDateInput(deal?.moveInDate),
    requirements: deal?.requirements ?? "",
    officeId: deal?.officeId ?? "",
    dealValue: deal?.dealValue ? String(deal.dealValue) : "",
    nextActionDate: toDateInput(deal?.nextActionDate),
    nextAction: deal?.nextAction ?? "",
    lostReason: deal?.lostReason ?? "",
    adminNotes: deal?.adminNotes ?? "",
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const payload: Record<string, unknown> = {
      contactName: form.contactName,
      phone: form.phone,
      stage: form.stage,
      priority: form.priority,
      source: form.source,
    };

    if (form.email) payload.email = form.email;
    if (form.companyName) payload.companyName = form.companyName;
    if (form.desiredArea) payload.desiredArea = form.desiredArea;
    if (form.budget) payload.budget = form.budget;
    if (form.moveInDate) payload.moveInDate = form.moveInDate;
    if (form.requirements) payload.requirements = form.requirements;
    if (form.officeId) payload.officeId = form.officeId;
    if (form.dealValue) payload.dealValue = Number(form.dealValue);
    if (form.nextActionDate) payload.nextActionDate = form.nextActionDate;
    if (form.nextAction) payload.nextAction = form.nextAction;
    if (form.lostReason) payload.lostReason = form.lostReason;
    if (form.adminNotes) payload.adminNotes = form.adminNotes;

    try {
      const url = isEdit
        ? `/api/rental/deals/${deal.id}`
        : "/api/rental/deals";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message || "Ошибка сохранения");
        setLoading(false);
        return;
      }

      router.refresh();
      onClose();
    } catch {
      setError("Ошибка сети");
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deal || !confirm("Удалить сделку?")) return;
    setLoading(true);

    const res = await fetch(`/api/rental/deals/${deal.id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError("Ошибка удаления");
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors";
  const labelCls = "block text-xs font-medium text-zinc-600 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-lg font-semibold text-zinc-900">
            {isEdit ? "Редактировать сделку" : "Новая сделка"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Contact Info */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800 mb-2">
              Контакт
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Имя *</label>
                <input
                  className={inputCls}
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  required
                  placeholder="Иван Петров"
                />
              </div>
              <div>
                <label className={labelCls}>Телефон *</label>
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  required
                  placeholder="+7 999 123-45-67"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Email</label>
                <input
                  className={inputCls}
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="ivan@example.com"
                />
              </div>
              <div>
                <label className={labelCls}>Компания</label>
                <input
                  className={inputCls}
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                  placeholder='ООО "Рога и Копыта"'
                />
              </div>
            </div>
          </fieldset>

          {/* Pipeline */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800 mb-2">
              Воронка
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Этап</label>
                <select
                  className={inputCls}
                  value={form.stage}
                  onChange={(e) => set("stage", e.target.value)}
                >
                  {Object.entries(stageLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Приоритет</label>
                <select
                  className={inputCls}
                  value={form.priority}
                  onChange={(e) => set("priority", e.target.value)}
                >
                  {priorityOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Источник</label>
                <select
                  className={inputCls}
                  value={form.source}
                  onChange={(e) => set("source", e.target.value)}
                >
                  {sourceOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          {/* Requirements */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800 mb-2">
              Потребности
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Площадь</label>
                <input
                  className={inputCls}
                  value={form.desiredArea}
                  onChange={(e) => set("desiredArea", e.target.value)}
                  placeholder="30-50 м²"
                />
              </div>
              <div>
                <label className={labelCls}>Бюджет</label>
                <input
                  className={inputCls}
                  value={form.budget}
                  onChange={(e) => set("budget", e.target.value)}
                  placeholder="до 50 000 ₽"
                />
              </div>
              <div>
                <label className={labelCls}>Заезд</label>
                <input
                  className={inputCls}
                  type="date"
                  value={form.moveInDate}
                  onChange={(e) => set("moveInDate", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Помещение</label>
              <select
                className={inputCls}
                value={form.officeId}
                onChange={(e) => set("officeId", e.target.value)}
              >
                <option value="">— не выбрано —</option>
                {offices
                  .filter((o) => o.status === "AVAILABLE" || o.id === deal?.officeId)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      К{o.building}-{o.number} ({o.floor} эт., {Number(o.area)} м²,{" "}
                      {Number(o.pricePerMonth).toLocaleString("ru-RU")} ₽)
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Пожелания</label>
              <textarea
                className={inputCls}
                rows={2}
                value={form.requirements}
                onChange={(e) => set("requirements", e.target.value)}
                placeholder="Нужен отдельный вход, мокрая точка..."
              />
            </div>
          </fieldset>

          {/* Deal Value & Next Steps */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-800 mb-2">
              Сделка
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Сумма сделки, ₽/мес</label>
                <input
                  className={inputCls}
                  type="number"
                  value={form.dealValue}
                  onChange={(e) => set("dealValue", e.target.value)}
                  placeholder="45 000"
                />
              </div>
              <div>
                <label className={labelCls}>Дата следующего действия</label>
                <input
                  className={inputCls}
                  type="date"
                  value={form.nextActionDate}
                  onChange={(e) => set("nextActionDate", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Следующий шаг</label>
              <input
                className={inputCls}
                value={form.nextAction}
                onChange={(e) => set("nextAction", e.target.value)}
                placeholder="Перезвонить, отправить КП..."
              />
            </div>
          </fieldset>

          {/* Lost reason (only when LOST) */}
          {form.stage === "LOST" && (
            <div>
              <label className={labelCls}>Причина проигрыша</label>
              <input
                className={inputCls}
                value={form.lostReason}
                onChange={(e) => set("lostReason", e.target.value)}
                placeholder="Ушёл к конкуренту, дорого..."
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={labelCls}>Заметки</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.adminNotes}
              onChange={(e) => set("adminNotes", e.target.value)}
              placeholder="Внутренние заметки..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
            <div>
              {isEdit && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  Удалить
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={loading}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Сохраняю..." : isEdit ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
