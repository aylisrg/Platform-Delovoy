"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { OfficeEditModal } from "./office-edit-modal";
import type { OfficeStatus, OfficeType } from "@prisma/client";

type Office = {
  id: string;
  number: string;
  floor: number;
  building: number;
  officeType: OfficeType;
  area: number;
  pricePerMonth: number;
  hasWetPoint: boolean;
  hasToilet: boolean;
  hasRoofAccess: boolean;
  status: OfficeStatus;
  comment: string | null;
  contracts: {
    tenant: { id: string; companyName: string };
  }[];
};

const statusLabel: Record<OfficeStatus, string> = {
  AVAILABLE: "Свободен",
  OCCUPIED: "Занят",
  MAINTENANCE: "Обслуживание",
  RESERVED: "Резерв",
};

const statusVariant: Record<OfficeStatus, "success" | "default" | "warning" | "danger"> = {
  AVAILABLE: "success",
  OCCUPIED: "default",
  MAINTENANCE: "warning",
  RESERVED: "danger",
};

const typeLabel: Record<OfficeType, string> = {
  OFFICE: "Офис",
  CONTAINER: "Контейнер",
  MEETING_ROOM: "Переговорная",
};

export function OfficeList({ offices }: { offices: Office[] }) {
  const [buildingFilter, setBuildingFilter] = useState<number | 0>(0);
  const [statusFilter, setStatusFilter] = useState<OfficeStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<OfficeType | "">("");
  const [editing, setEditing] = useState<Office | null>(null);

  const buildings = useMemo(
    () => [...new Set(offices.map((o) => o.building))].sort(),
    [offices]
  );

  const filtered = useMemo(() => {
    let result = offices;
    if (buildingFilter) result = result.filter((o) => o.building === buildingFilter);
    if (statusFilter) result = result.filter((o) => o.status === statusFilter);
    if (typeFilter) result = result.filter((o) => o.officeType === typeFilter);
    return result;
  }, [offices, buildingFilter, statusFilter, typeFilter]);

  // Group by building and floor
  const grouped = useMemo(() => {
    const map = new Map<string, Office[]>();
    for (const o of filtered) {
      const key = `${o.building}-${o.floor}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const occupied = filtered.filter((o) => o.status === "OCCUPIED").length;
    const available = filtered.filter((o) => o.status === "AVAILABLE").length;
    const totalArea = filtered.reduce((s, o) => s + Number(o.area), 0);
    return { total, occupied, available, totalArea };
  }, [filtered]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={buildingFilter}
          onChange={(e) => setBuildingFilter(Number(e.target.value))}
          className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value={0}>Все корпуса</option>
          {buildings.map((b) => (
            <option key={b} value={b}>Корпус {b}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OfficeStatus | "")}
          className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Все статусы</option>
          <option value="AVAILABLE">Свободен</option>
          <option value="OCCUPIED">Занят</option>
          <option value="MAINTENANCE">Обслуживание</option>
          <option value="RESERVED">Резерв</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as OfficeType | "")}
          className="px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Все типы</option>
          <option value="OFFICE">Офис</option>
          <option value="CONTAINER">Контейнер</option>
          <option value="MEETING_ROOM">Переговорная</option>
        </select>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-4 text-xs text-zinc-500">
        <span>Всего: <strong className="text-zinc-900">{stats.total}</strong></span>
        <span>Занято: <strong className="text-zinc-900">{stats.occupied}</strong></span>
        <span>Свободно: <strong className="text-green-700">{stats.available}</strong></span>
        <span>Площадь: <strong className="text-zinc-900">{stats.totalArea.toFixed(1)} м²</strong></span>
      </div>

      {/* Grid by building/floor */}
      {grouped.map(([key, list]) => {
        const [building, floor] = key.split("-").map(Number);
        return (
          <div key={key} className="mb-5">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Корпус {building}, {floor} этаж
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {list.map((o) => (
                <div
                  key={o.id}
                  onClick={() => setEditing(o)}
                  role="button"
                  tabIndex={0}
                  className={`p-3 rounded-lg border text-sm transition-colors cursor-pointer hover:shadow-md ${
                    o.status === "AVAILABLE"
                      ? "border-green-200 bg-green-50/50"
                      : o.status === "OCCUPIED"
                      ? "border-zinc-200 bg-white"
                      : o.status === "RESERVED"
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-orange-200 bg-orange-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-zinc-900">
                      {o.officeType === "CONTAINER" ? "К" : ""}
                      {o.number}
                    </span>
                    <Badge variant={statusVariant[o.status]} className="text-[10px] px-1.5">
                      {statusLabel[o.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {Number(o.area)} м² · {typeLabel[o.officeType]}
                  </div>
                  {o.contracts.length > 0 && (
                    <div className="mt-1.5 text-xs text-zinc-700 truncate" title={o.contracts[0].tenant.companyName}>
                      {o.contracts[0].tenant.companyName}
                    </div>
                  )}
                  {(o.hasWetPoint || o.hasToilet || o.hasRoofAccess) && (
                    <div className="mt-1 flex gap-1">
                      {o.hasWetPoint && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600" title="Мокрая точка">💧</span>
                      )}
                      {o.hasToilet && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600" title="Туалет">🚻</span>
                      )}
                      {o.hasRoofAccess && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 text-blue-600" title="Кровля">🏗</span>
                      )}
                    </div>
                  )}
                  {o.comment && (
                    <div className="mt-1 text-[10px] text-zinc-400 italic truncate" title={o.comment}>
                      {o.comment}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {editing && (
        <OfficeEditModal
          office={editing}
          open={true}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
