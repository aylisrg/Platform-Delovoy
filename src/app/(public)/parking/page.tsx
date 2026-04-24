import type { Metadata } from "next";
import { getParkingInfo } from "@/modules/parking/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

const APP_URL = "https://delovoy-park.ru";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Парковка", item: `${APP_URL}/parking` },
      ],
    },
    {
      "@type": "ParkingFacility",
      "@id": `${APP_URL}/parking`,
      name: "Парковка Деловой Парк",
      description: "Бесплатная охраняемая парковка для арендаторов и гостей бизнес-парка Деловой, Селятино. 200+ машиномест.",
      url: `${APP_URL}/parking`,
      isAccessibleForFree: true,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Селятино",
        addressRegion: "Московская область",
        addressCountry: "RU",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 55.519479,
        longitude: 36.978566,
      },
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: "00:00",
        closes: "23:59",
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Парковка",
  description:
    "Бесплатная парковка для арендаторов и гостей бизнес-парка Деловой, Селятино. 200+ машиномест. Видеонаблюдение, охрана.",
  alternates: {
    canonical: "/parking",
  },
  openGraph: {
    title: "Парковка — Деловой Парк",
    description: "200+ машиномест, бесплатно для арендаторов и гостей. Бизнес-парк Деловой, Селятино.",
    url: "/parking",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default function ParkingPage() {
  const info = getParkingInfo();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-zinc-50">
        <Navbar />
        <div className="pt-14">
          <header className="bg-white border-b border-zinc-200">
            <div className="max-w-4xl mx-auto px-4 py-8">
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
          <Footer />
        </div>
      </div>
    </>
  );
}
