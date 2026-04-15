import type { Metadata } from "next";
import { listOffices } from "@/modules/rental/service";
import { RentalPageContent } from "@/components/public/rental/rental-page-content";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

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
  );
}
