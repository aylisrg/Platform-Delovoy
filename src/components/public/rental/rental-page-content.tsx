"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InquiryForm } from "./inquiry-form";
import type { OfficeStatus } from "@prisma/client";

type Office = {
  id: string;
  number: string;
  floor: number;
  area: number | string;
  pricePerMonth: number | string;
  status: OfficeStatus;
};

const statusLabel: Record<OfficeStatus, string> = {
  AVAILABLE: "Свободен",
  OCCUPIED: "Занят",
  MAINTENANCE: "На обслуживании",
  RESERVED: "Зарезервирован",
};

const statusVariant: Record<OfficeStatus, "success" | "default" | "warning"> = {
  AVAILABLE: "success",
  OCCUPIED: "default",
  MAINTENANCE: "warning",
  RESERVED: "warning",
};

export function RentalPageContent({ offices }: { offices: Office[] }) {
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>([]);
  const formRef = useRef<HTMLDivElement>(null);

  const available = offices.filter((o) => o.status === "AVAILABLE");
  const floors = [...new Set(offices.map((o) => o.floor))].sort((a, b) => a - b);

  const handleSelectOffice = useCallback((officeId: string) => {
    setSelectedOfficeIds((prev) => {
      if (prev.includes(officeId)) return prev;
      return [...prev, officeId];
    });
    // Scroll to form
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, []);

  const handleDeselectOffice = useCallback((officeId: string) => {
    setSelectedOfficeIds((prev) => prev.filter((id) => id !== officeId));
  }, []);

  const handleFormReset = useCallback(() => {
    setSelectedOfficeIds([]);
  }, []);

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-sm text-zinc-500">Всего офисов</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{offices.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-zinc-500">Свободных</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{available.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-zinc-500">Этажей</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{floors.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Office catalog by floor */}
      {floors.map((floor) => {
        const floorOffices = offices.filter((o) => o.floor === floor);
        return (
          <section key={floor}>
            <h2 className="text-lg font-semibold text-zinc-900 mb-4">{floor} этаж</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {floorOffices.map((office) => {
                const isSelected = selectedOfficeIds.includes(office.id);
                return (
                  <Card
                    key={office.id}
                    className={`${office.status !== "AVAILABLE" ? "opacity-60" : ""} ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                  >
                    <CardContent>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-lg font-bold text-zinc-900">Офис №{office.number}</p>
                          <p className="text-sm text-zinc-500">{floor} этаж</p>
                        </div>
                        <Badge variant={statusVariant[office.status]}>
                          {statusLabel[office.status]}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-sm text-zinc-600">
                        <div className="flex justify-between">
                          <span>Площадь:</span>
                          <span className="font-medium">{Number(office.area)} м²</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Цена/месяц:</span>
                          <span className="font-medium text-zinc-900">
                            {Number(office.pricePerMonth).toLocaleString("ru-RU")} ₽
                          </span>
                        </div>
                      </div>

                      {office.status === "AVAILABLE" && (
                        <button
                          onClick={() =>
                            isSelected
                              ? handleDeselectOffice(office.id)
                              : handleSelectOffice(office.id)
                          }
                          className={`mt-3 w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                            isSelected
                              ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                              : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {isSelected ? "✓ Выбран" : "Отправить запрос"}
                        </button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      {offices.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-sm text-zinc-400 text-center py-8">
              Информация об офисах временно недоступна
            </p>
          </CardContent>
        </Card>
      )}

      {/* Inquiry Form */}
      <div ref={formRef} id="inquiry-form">
        <InquiryForm
          offices={offices.map((o) => ({
            id: o.id,
            number: o.number,
            floor: o.floor,
            status: o.status,
          }))}
          selectedOfficeIds={selectedOfficeIds}
          onToggleOffice={(id) =>
            selectedOfficeIds.includes(id)
              ? handleDeselectOffice(id)
              : setSelectedOfficeIds((prev) => [...prev, id])
          }
          onFormReset={handleFormReset}
        />
      </div>
    </div>
  );
}
