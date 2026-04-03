"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type TimeSlot = {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
};

type ResourceAvailability = {
  date: string;
  resource: {
    id: string;
    name: string;
    pricePerHour: string | number | null;
    capacity: number | null;
  };
  slots: TimeSlot[];
};

export function AvailabilityCalendar() {
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [availability, setAvailability] = useState<ResourceAvailability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkAvailability() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gazebos/availability?date=${date}`);
      const data = await res.json();
      if (data.success) {
        setAvailability(data.data);
      } else {
        setError(data.error?.message ?? "Ошибка загрузки");
      }
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="date" className="block text-sm font-medium text-zinc-700">
              Дата
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="mt-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <Button onClick={checkAvailability} disabled={loading}>
            {loading ? "Загрузка..." : "Проверить"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <p className="text-sm text-red-600 mb-4">{error}</p>
        )}

        {availability.length === 0 && !loading && !error && (
          <p className="text-sm text-zinc-400">
            Выберите дату и нажмите «Проверить» для просмотра доступных слотов
          </p>
        )}

        {availability.map((item) => (
          <div key={item.resource.id} className="mb-6 last:mb-0">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold text-zinc-900">{item.resource.name}</h3>
              {item.resource.capacity && (
                <span className="text-xs text-zinc-400">
                  до {item.resource.capacity} чел.
                </span>
              )}
              {item.resource.pricePerHour && (
                <Badge variant="info">{Number(item.resource.pricePerHour)} ₽/час</Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {item.slots.map((slot) => (
                <button
                  key={slot.startTime}
                  disabled={!slot.isAvailable}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    slot.isAvailable
                      ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                      : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  }`}
                >
                  {slot.startTime}–{slot.endTime}
                </button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
