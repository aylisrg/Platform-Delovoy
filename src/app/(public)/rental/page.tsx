import Link from "next/link";
import { listOffices } from "@/modules/rental/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InquiryForm } from "@/components/public/rental/inquiry-form";
import type { OfficeStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const statusLabel: Record<OfficeStatus, string> = {
  AVAILABLE: "Свободен",
  OCCUPIED: "Занят",
  MAINTENANCE: "На обслуживании",
};

const statusVariant: Record<OfficeStatus, "success" | "default" | "warning"> = {
  AVAILABLE: "success",
  OCCUPIED: "default",
  MAINTENANCE: "warning",
};

export default async function RentalPage() {
  const offices = await listOffices();

  const available = offices.filter((o) => o.status === "AVAILABLE");
  const floors = [...new Set(offices.map((o) => o.floor))].sort((a, b) => a - b);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </Link>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">Аренда офисов</h1>
          <p className="mt-2 text-zinc-600">
            Бизнес-парк Деловой — современные офисы в Селятино, Московская область
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
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
                {floorOffices.map((office) => (
                  <Card key={office.id} className={office.status !== "AVAILABLE" ? "opacity-60" : ""}>
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
                    </CardContent>
                  </Card>
                ))}
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

        {/* Contact CTA */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent>
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">
              Заинтересованы в аренде?
            </h2>
            <p className="text-sm text-zinc-600 mb-4">
              Свяжитесь с нашим менеджером, чтобы обсудить условия аренды,
              получить полную информацию и договориться об осмотре офиса.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="tel:+74991234567"
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Позвонить менеджеру
              </a>
              <a
                href="mailto:rental@delovoy-park.ru"
                className="inline-flex items-center justify-center rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                Написать на email
              </a>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
