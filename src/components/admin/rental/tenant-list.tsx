"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { TenantEditModal } from "./tenant-edit-modal";
import type { TenantType } from "@prisma/client";

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

function formatPhone(phone: string): string {
  if (phone.length === 11 && phone.startsWith("7")) {
    return `+7 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`;
  }
  return phone;
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
        {filtered.map((t) => (
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
                <div className="flex justify-end mb-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(t); }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    Редактировать
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-zinc-400 text-xs">Контакт</span>
                    <p className="text-zinc-900">{t.contactName || "—"}</p>
                  </div>
                  <div>
                    <span className="text-zinc-400 text-xs">Телефон</span>
                    <p>
                      {t.phone ? (
                        <a href={`tel:+${t.phone}`} className="text-blue-600 hover:underline">
                          {formatPhone(t.phone)}
                        </a>
                      ) : "—"}
                      {t.phonesExtra && Array.isArray(t.phonesExtra) && (t.phonesExtra as string[]).length > 0 && (
                        <span className="text-zinc-400 ml-1">
                          (+{(t.phonesExtra as string[]).length})
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400 text-xs">Email</span>
                    <p>
                      {t.email ? (
                        <a href={`mailto:${t.email}`} className="text-blue-600 hover:underline">
                          {t.email}
                        </a>
                      ) : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400 text-xs">ИНН</span>
                    <p className="text-zinc-900 font-mono">{t.inn || "—"}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-zinc-400 text-xs">Заметки</span>
                    <p className="text-zinc-600">{t.notes || "—"}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
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
