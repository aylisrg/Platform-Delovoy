import type { Metadata } from "next";
import { getMenu, getMenuCategories } from "@/modules/cafe/service";
import { MenuList } from "@/components/public/cafe/menu-list";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";

export const dynamic = "force-dynamic";

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
  );
}
