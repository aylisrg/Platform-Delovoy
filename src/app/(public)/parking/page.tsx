import { getParkingInfo } from "@/modules/parking/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ParkingPage() {
  const info = getParkingInfo();

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <a href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </a>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">Парковка</h1>
          <p className="mt-2 text-zinc-600">
            Информация о парковке бизнес-парка Деловой
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-sm text-zinc-500">Всего мест</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{info.totalSpots}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-zinc-500">Для арендаторов</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{info.tenantSpots}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-zinc-500">Гостевых мест</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{info.guestSpots}</p>
            </CardContent>
          </Card>
        </div>

        {/* Operating hours */}
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">Режим работы</h2>
            <div className="flex items-center gap-2">
              <Badge variant="success">Открыто</Badge>
              <span className="text-zinc-600">{info.operatingHours}</span>
            </div>
          </CardContent>
        </Card>

        {/* Rules */}
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold text-zinc-900 mb-4">Правила парковки</h2>
            <ul className="space-y-3">
              {info.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-zinc-600">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium shrink-0">
                    {i + 1}
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Contacts */}
        {info.contacts.phone && (
          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold text-zinc-900 mb-2">Контакты</h2>
              <p className="text-sm text-zinc-600">
                По вопросам парковки:{" "}
                <a href={`tel:${info.contacts.phone}`} className="text-blue-600 hover:underline">
                  {info.contacts.phone}
                </a>
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
