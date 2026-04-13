"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ContractActions } from "./contract-actions";
import { ContractEditModal } from "./contract-edit-modal";
import type { ContractStatus } from "@prisma/client";

type Contract = {
  id: string;
  tenantId: string;
  officeId: string;
  startDate: string;
  endDate: string;
  pricePerSqm: number | null;
  monthlyRate: number;
  currency: string;
  newPricePerSqm: number | null;
  priceIncreaseDate: string | null;
  contractNumber: string | null;
  deposit: number | null;
  status: ContractStatus;
  notes: string | null;
  tenant: { companyName: string };
  office: { number: string; floor: number; building: number };
};

const statusLabel: Record<ContractStatus, string> = {
  DRAFT: "Черновик",
  ACTIVE: "Активен",
  EXPIRING: "Истекает",
  EXPIRED: "Истёк",
  TERMINATED: "Расторгнут",
};

const statusVariant: Record<ContractStatus, "warning" | "success" | "default" | "info" | "danger"> = {
  DRAFT: "info",
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "default",
  TERMINATED: "danger",
};

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function ContractList({ contracts }: { contracts: Contract[] }) {
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "">("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contract | null>(null);

  const filtered = useMemo(() => {
    let result = contracts;
    if (statusFilter) result = result.filter((c) => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.tenant.companyName.toLowerCase().includes(q) ||
          c.office.number.includes(q) ||
          c.contractNumber?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [contracts, statusFilter, search]);

  // Stats
  const stats = useMemo(() => {
    const active = contracts.filter((c) => c.status === "ACTIVE" || c.status === "EXPIRING");
    const totalRevenue = active.reduce((s, c) => s + Number(c.monthlyRate), 0);
    return {
      active: active.length,
      expiring: contracts.filter((c) => c.status === "EXPIRING").length,
      revenue: totalRevenue,
    };
  }, [contracts]);

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-green-50 px-4 py-3">
          <p className="text-xs text-green-600">Активных</p>
          <p className="text-lg font-bold text-green-900">{stats.active}</p>
        </div>
        <div className="rounded-lg bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-600">Истекают</p>
          <p className="text-lg font-bold text-amber-900">{stats.expiring}</p>
        </div>
        <div className="rounded-lg bg-blue-50 px-4 py-3">
          <p className="text-xs text-blue-600">Выручка/мес</p>
          <p className="text-lg font-bold text-blue-900">{fmtMoney(stats.revenue)} ₽</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Поиск по арендатору, помещению, номеру договора..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContractStatus | "")}
          className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Все статусы</option>
          <option value="ACTIVE">Активен</option>
          <option value="EXPIRING">Истекает</option>
          <option value="DRAFT">Черновик</option>
          <option value="EXPIRED">Истёк</option>
          <option value="TERMINATED">Расторгнут</option>
        </select>
      </div>

      <div className="text-xs text-zinc-400 mb-3">
        Показано: {filtered.length} из {contracts.length}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500">
              <th className="pb-3 pr-3 font-medium">Помещение</th>
              <th className="pb-3 pr-3 font-medium">Арендатор</th>
              <th className="pb-3 pr-3 font-medium whitespace-nowrap">Период</th>
              <th className="pb-3 pr-3 font-medium whitespace-nowrap">Ставка/м²</th>
              <th className="pb-3 pr-3 font-medium whitespace-nowrap">Сумма/мес</th>
              <th className="pb-3 pr-3 font-medium">Статус</th>
              <th className="pb-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                <td className="py-3 pr-3">
                  <span className="font-medium text-zinc-900">
                    К{c.office.building} · №{c.office.number}
                  </span>
                  <span className="text-zinc-400 text-xs ml-1">
                    ({c.office.floor} эт.)
                  </span>
                </td>
                <td className="py-3 pr-3 text-zinc-700 max-w-[200px] truncate" title={c.tenant.companyName}>
                  {c.tenant.companyName}
                </td>
                <td className="py-3 pr-3 text-zinc-600 whitespace-nowrap text-xs">
                  {fmtDate(c.startDate)} — {fmtDate(c.endDate)}
                </td>
                <td className="py-3 pr-3 text-zinc-600 whitespace-nowrap">
                  {c.pricePerSqm ? `${fmtMoney(Number(c.pricePerSqm))} ₽` : "—"}
                  {c.newPricePerSqm && (
                    <span className="ml-1 text-xs text-amber-600">
                      → {fmtMoney(Number(c.newPricePerSqm))}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-3 text-zinc-900 font-medium whitespace-nowrap">
                  {fmtMoney(Number(c.monthlyRate))} ₽
                </td>
                <td className="py-3 pr-3">
                  <Badge variant={statusVariant[c.status]}>
                    {statusLabel[c.status]}
                  </Badge>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditing(c)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Изм.
                    </button>
                    <ContractActions contractId={c.id} currentStatus={c.status} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ContractEditModal
          contract={editing}
          open={true}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
