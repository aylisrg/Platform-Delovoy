"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { InquiryForm } from "./inquiry-form";

type Office = {
  id: string;
  number: string;
  floor: number;
  area: number;
  pricePerMonth: number;
  status: string;
};

export function RentalPageContent({
  offices,
}: {
  offices: Office[];
}) {
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>([]);
  const formRef = useRef<HTMLDivElement>(null);

  const totalOffices = offices.length;
  const available = offices.filter((o) => o.status === "AVAILABLE");
  const occupancyPercent = totalOffices > 0
    ? Math.round(((totalOffices - available.length) / totalOffices) * 100)
    : 100;

  const handleSelectOffice = useCallback((officeId: string) => {
    setSelectedOfficeIds((prev) => {
      if (prev.includes(officeId)) return prev;
      return [...prev, officeId];
    });
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
      {/* Occupancy banner */}
      <div className="rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-800 p-6 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
            <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold">Загрузка парка — {occupancyPercent}%</p>
            <p className="text-sm text-zinc-400">Почти все помещения заняты</p>
          </div>
        </div>
        <div className="w-full bg-zinc-700 rounded-full h-2 mb-4">
          <div
            className="bg-green-500 h-2 rounded-full transition-all"
            style={{ width: `${occupancyPercent}%` }}
          />
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed">
          Бизнес-парк «Деловой» работает на полную мощность. Иногда арендаторы освобождают помещения —
          ниже актуальный список вакантных офисов. Если ничего не подходит, оставьте заявку —
          мы свяжемся, как только появится подходящий вариант.
        </p>
      </div>

      {/* Available offices */}
      {available.length > 0 ? (
        <section>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">
            Доступные помещения
          </h2>
          <p className="text-sm text-zinc-500 mb-5">
            {available.length === 1
              ? "Сейчас свободен 1 офис"
              : `Сейчас свободно ${available.length} офисов`}
             из {totalOffices}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((office) => {
              const isSelected = selectedOfficeIds.includes(office.id);
              return (
                <Card
                  key={office.id}
                  className={`border-green-200 ${isSelected ? "ring-2 ring-blue-500" : ""}`}
                >
                  <CardContent>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-lg font-bold text-zinc-900">
                          Офис №{office.number}
                        </p>
                        <p className="text-sm text-zinc-500">{office.floor} этаж</p>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        Свободен
                      </span>
                    </div>

                    <div className="space-y-1 text-sm text-zinc-600">
                      <div className="flex justify-between">
                        <span>Площадь:</span>
                        <span className="font-medium">{office.area} м²</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Цена/месяц:</span>
                        <span className="font-semibold text-zinc-900">
                          {office.pricePerMonth.toLocaleString("ru-RU")} ₽
                        </span>
                      </div>
                    </div>

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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-lg font-semibold text-zinc-900 mb-1">
            Все помещения заняты
          </p>
          <p className="text-sm text-zinc-600">
            Сейчас свободных офисов нет, но вы можете оставить заявку ниже —
            мы свяжемся с вами, как только появится вакантное помещение.
          </p>
        </div>
      )}

      {/* Inquiry Form */}
      <div ref={formRef} id="inquiry-form">
        <InquiryForm
          offices={available.map((o) => ({
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
