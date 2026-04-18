import type { Metadata } from "next";
import { getMenu, getMenuCategories } from "@/modules/cafe/service";
import { MenuList } from "@/components/public/cafe/menu-list";
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
        { "@type": "ListItem", position: 2, name: "Кафе", item: `${APP_URL}/cafe` },
      ],
    },
    {
      "@type": "FoodEstablishment",
      "@id": `${APP_URL}/cafe`,
      name: "Кафе Деловой Парк",
      description: "Кафе в бизнес-парке Деловой с доставкой еды прямо в офис. Завтраки, обеды, пицца, напитки.",
      url: `${APP_URL}/cafe`,
      servesCuisine: ["Русская", "Европейская"],
      hasMenu: `${APP_URL}/cafe`,
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
      potentialAction: {
        "@type": "OrderAction",
        target: `${APP_URL}/cafe`,
        deliveryMethod: "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Кафе",
  description:
    "Кафе в бизнес-парке Деловой, Селятино. Завтраки, обеды, пицца, напитки. Доставка прямо в ваш офис. Онлайн-заказ.",
  alternates: {
    canonical: "/cafe",
  },
  openGraph: {
    title: "Кафе — Деловой Парк",
    description: "Завтраки, обеды, пицца, напитки с доставкой в офис. Бизнес-парк Деловой, Селятино.",
    url: "/cafe",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function CafePage() {
  const [items, categories] = await Promise.all([
    getMenu(),
    getMenuCategories(),
  ]);

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
            <div className="max-w-6xl mx-auto px-4 py-8">
              <h1 className="text-3xl font-bold text-zinc-900">Кафе</h1>
              <p className="mt-2 text-zinc-600">
                Меню кафе бизнес-парка Деловой. Закажите еду с доставкой в офис.
              </p>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-4 py-8 pb-24 lg:pb-8">
            <MenuList items={items} categories={categories} />
          </main>
          <Footer />
        </div>
      </div>
    </>
  );
}
