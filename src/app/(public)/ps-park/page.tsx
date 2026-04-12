import type { Metadata } from "next";
import Link from "next/link";
import { listTables, getAvailability } from "@/modules/ps-park/service";
import { TableList } from "@/components/public/ps-park/table-list";
import { PublicAvailabilityGrid } from "@/components/public/ps-park/public-availability-grid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PlayStation Park",
  description:
    "PlayStation Park в бизнес-парке Деловой, Селятино. PS5, FIFA, гоночные симуляторы. Аренда столов с PlayStation по часам. Онлайн-бронирование.",
  alternates: {
    canonical: "/ps-park",
  },
  openGraph: {
    title: "PlayStation Park — Деловой Парк",
    description: "Аренда PS5 по часам. Селятино, Московская область. Онлайн-бронирование столов.",
    url: "/ps-park",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export default async function PSParkPage() {
  const today = new Date().toISOString().split("T")[0];
  const [tables, initialAvailability] = await Promise.all([
    listTables(true),
    getAvailability(today),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              &larr; Главная
            </Link>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">PlayStation Park</h1>
          <p className="mt-2 text-zinc-600">
            Забронируйте стол с PlayStation на территории бизнес-парка Деловой
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <section>
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Наши столы</h2>
          <TableList resources={tables} />
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Доступность и бронирование</h2>
          <PublicAvailabilityGrid
            initialAvailability={initialAvailability}
            initialDate={today}
          />
        </section>
      </main>
    </div>
  );
}
