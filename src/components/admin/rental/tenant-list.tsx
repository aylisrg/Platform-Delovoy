"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { TenantEditModal } from "./tenant-edit-modal";
import { PhoneActions } from "@/components/admin/telephony/phone-actions";
import type { TenantType, ContractStatus, OfficeType } from "@prisma/client";

type TenantContract = {
  id: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  pricePerSqm: number | null;
  monthlyRate: number;
  documentUrl: string | null;
  office: {
    id: string;
    number: string;
    floor: number;
    building: number;
    area: number;
    officeType: OfficeType;
  };
};

type Tenant = {
  id: string;
  companyName: string;
  tenantType: TenantType;
  contactName: string | null;
  phone: string | null;
  phonesExtra: string[] | null;
  email: string | null;
  emailsExtra: string[] | null;
  inn: string | null;
  legalAddress: string | null;
  needsLegalAddress: boolean;
  notes: string | null;
  _count: { contracts: number };
  contracts: TenantContract[];
};

const typeLabel: Record<TenantType, string> = {
  COMPANY: "ООО",
  IP: "ИП",
  INDIVIDUAL: "Физлицо",
};

const typeVariant: Record<TenantType, "info" | "success" | "default"> = {
  COMPANY: "info",
  IP: "success",
  INDIVIDUAL: "default",
};

const statusLabel: Record<ContractStatus, string> = {
  DRAFT: "Черновик",
  ACTIVE: "Активен",
  EXPIRING: "Истекает",
  EXPIRED: "Истёк",
  TERMINATED: "Расторгнут",
};

const statusVariant: Record<ContractStatus, "info" | "success" | "warning" | "default" | "danger"> = {
  DRAFT: "info",
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "default",
  TERMINATED: "danger",
};

function formatPhone(phone: string): string {
  if (phone.length === 11 && phone.startsWith("7")) {
    return `+7 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`;
  }
  return phone;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("ru-RU");
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function TenantList({ tenants }: { tenants: Tenant[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TenantType | "">("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tenant | null>(null);

  const filtered = useMemo(() => {
    let result = tenants;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.companyName.toLowerCase().includes(q) ||
          t.contactName?.toLowerCase().includes(q) ||
          t.phone?.includes(q) ||
          t.email?.toLowerCase().includes(q) ||
          t.inn?.includes(q)
      );
    }
    if (typeFilter) {
      result = result.filter((t) => t.tenantType === typeFilter);
    }
    return result;
  }, [tenants, search, typeFilter]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Поиск по имени, телефону, email, ИНН..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TenantType | "")}
          className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Все типы</option>
          <option value="COMPANY">ООО / АО</option>
          <option value="IP">ИП</option>
          <option value="INDIVIDUAL">Физлицо</option>
        </select>
      </div>

      <div className="text-xs text-zinc-400 mb-3">
        Найдено: {filtered.length} из {tenants.length}
      </div>

      <div className="space-y-1">
        {filtered.map((t) => {
          const activeContracts = t.contracts.filter(
            (c) => c.status === "ACTIVE" || c.status === "EXPIRING"
          );
          const totalMonthly = activeContracts.reduce((s, c) => s + c.monthlyRate, 0);

          return (
            <div key={t.id} className="border border-zinc-100 rounded-lg hover:border-zinc-200 transition-colors">
              <button
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <Badge variant={typeVariant[t.tenantType]} className="shrink-0">
                  {typeLabel[t.tenantType]}
                </Badge>
                <span className="font-medium text-sm text-zinc-900 flex-1 truncate">
                  {t.companyName}
                </span>
                {t.needsLegalAddress && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium shrink-0">
                    ЮР.АДРЕС
                  </span>
                )}
                {totalMonthly > 0 && (
                  <span className="text-xs text-zinc-500 shrink-0 hidden sm:inline">
                    {fmtMoney(totalMonthly)} ₽/мес
                  </span>
                )}
                <span className="text-xs text-zinc-400 shrink-0">
                  {t._count.contracts} дог.
                </span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ${expanded === t.id ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded === t.id && (
                <div className="px-4 pb-4 pt-1 border-t border-zinc-50">
                  {/* Header: контакты + кнопка редактирования */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      {t.contactName && (
                        <span className="text-zinc-700">{t.contactName}</span>
                      )}
                      {t.phone && (
                        <PhoneActions
                          phone={t.phone}
                          tenantId={t.id}
                          displayPhone={formatPhone(t.phone)}
                        />
                      )}
                      {t.phonesExtra && Array.isArray(t.phonesExtra) && (t.phonesExtra as string[]).map((p, i) => (
                        <PhoneActions
                          key={i}
                          phone={p}
                          tenantId={t.id}
                          displayPhone={formatPhone(p)}
                        />
                      ))}
                      {t.email && (
                        <a href={`mailto:${t.email}`} className="text-blue-600 hover:underline">
                          {t.email}
                        </a>
                      )}
                      {t.inn && (
                        <span className="text-zinc-500 font-mono text-xs self-center">ИНН {t.inn}</span>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(t); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors shrink-0 ml-3"
                    >
                      Редактировать
                    </button>
                  </div>

                  {/* Арендуемые помещения */}
                  {t.contracts.length > 0 ? (
                    <div className="space-y-2">
                      {t.contracts.map((c) => {
                        const days = daysUntil(c.endDate);
                        const isActive = c.status === "ACTIVE" || c.status === "EXPIRING";

                        return (
                          <div
                            key={c.id}
                            className={`rounded-lg border p-3 text-sm ${
                              c.status === "EXPIRING"
                                ? "border-amber-200 bg-amber-50/30"
                                : isActive
                                ? "border-zinc-200 bg-white"
                                : "border-zinc-100 bg-zinc-50/50 opacity-70"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-zinc-900">
                                  К{c.office.building} · №{c.office.number}
                                </span>
                                <span className="text-zinc-400 text-xs">
                                  {c.office.floor} эт.
                                </span>
                                <span className="text-zinc-400 text-xs">
                                  {c.office.officeType === "CONTAINER" ? "контейнер" : "офис"}
                                </span>
                              </div>
                              <Badge variant={statusVariant[c.status]}>
                                {statusLabel[c.status]}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                              <div>
                                <span className="text-zinc-400 text-[11px]">Площадь</span>
                                <p className="text-zinc-900 font-medium">{c.office.area} м²</p>
                              </div>
                              <div>
                                <span className="text-zinc-400 text-[11px]">Ставка/м²</span>
                                <p className="text-zinc-900 font-medium">
                                  {c.pricePerSqm ? `${fmtMoney(c.pricePerSqm)} ₽` : "—"}
                                </p>
                              </div>
                              <div>
                                <span className="text-zinc-400 text-[11px]">Сумма/мес</span>
                                <p className="text-zinc-900 font-bold">{fmtMoney(c.monthlyRate)} ₽</p>
                              </div>
                              <div>
                                <span className="text-zinc-400 text-[11px]">Окончание</span>
                                <p className={`font-medium ${
                                  days <= 0 ? "text-red-600" :
                                  days <= 30 ? "text-amber-600" :
                                  "text-zinc-900"
                                }`}>
                                  {fmtDate(c.endDate)}
                                  {isActive && days > 0 && (
                                    <span className="text-zinc-400 font-normal text-xs ml-1">
                                      ({days} дн.)
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Период + документ */}
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-100">
                              <span className="text-xs text-zinc-400">
                                {fmtDate(c.startDate)} — {fmtDate(c.endDate)}
                              </span>
                              {c.documentUrl ? (
                                <a
                                  href={c.documentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                                  Договор
                                </a>
                              ) : (
                                <span className="text-xs text-zinc-300">нет документа</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400 italic">Нет договоров</p>
                  )}

                  {/* Заметки */}
                  {t.notes && (
                    <div className="mt-3 pt-2 border-t border-zinc-50">
                      <span className="text-zinc-400 text-xs">Заметки</span>
                      <p className="text-sm text-zinc-600">{t.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <TenantEditModal
          tenant={editing}
          open={true}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
