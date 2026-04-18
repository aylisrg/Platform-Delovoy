import type { Metadata } from "next";
import { listOffices } from "@/modules/rental/service";
import { RentalPageContent } from "@/components/public/rental/rental-page-content";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

const APP_URL = "https://delovoy-park.ru";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Аренда офисов", item: `${APP_URL}/rental` },
      ],
    },
    {
      "@type": "RealEstateAgent",
      "@id": `${APP_URL}/rental`,
      name: "Аренда офисов — Деловой Парк",
      description: "Аренда офисов от 15 м² с готовой отделкой, интернетом, охраной и парковкой. Бизнес-парк Деловой, Селятино.",
      url: `${APP_URL}/rental`,
      telephone: process.env.DELOVOY_PHONE || "+7-000-000-00-00",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Селятино",
        addressRegion: "Московская область",
        addressCountry: "RU",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: 55.5167,
        longitude: 36.9667,
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          opens: "08:00",
          closes: "20:00",
        },
      ],
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Офисные помещения",
        itemListElement: [
          {
            "@type": "Offer",
            name: "Офис от 15 м²",
            description: "Готовая отделка, интернет, охрана, парковка включены",
            priceCurrency: "RUB",
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              unitText: "мес",
            },
          },
        ],
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Аренда офисов",
  description:
    "Аренда офисов в бизнес-парке Деловой, Селятино, Московская область. Офисы от 15 м² с отделкой, интернетом, парковкой. Вступайте в лист ожидания.",
  alternates: {
    canonical: "/rental",
  },
  openGraph: {
    title: "Аренда офисов — Деловой Парк",
    description: "Офисы от 15 м² в Селятино. Готовая отделка, интернет, охрана, парковка. Московская область.",
    url: "/rental",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function RentalPage() {
  const offices = await listOffices();

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
            <div className="max-w-5xl mx-auto px-4 py-8">
              <h1 className="text-3xl font-bold text-zinc-900">Аренда офисов</h1>
              <p className="mt-2 text-zinc-600">
                Бизнес-парк «Деловой» — современные офисы в Селятино, Московская область. Готовая отделка, интернет, охрана, парковка.
              </p>
            </div>
          </header>

          <main className="max-w-5xl mx-auto px-4 py-8">
            <RentalPageContent
              offices={offices.map((o) => ({
                id: o.id,
                number: o.number,
                floor: o.floor,
                area: Number(o.area),
                pricePerMonth: Number(o.pricePerMonth),
                status: o.status,
              }))}
            />
          </main>
          <Footer />
        </div>
      </div>
    </>
  );
}
