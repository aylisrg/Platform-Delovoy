import Link from "next/link";
import { getMenu, getMenuCategories } from "@/modules/cafe/service";
import { MenuList } from "@/components/public/cafe/menu-list";

export const dynamic = "force-dynamic";

export default async function CafePage() {
  const [items, categories] = await Promise.all([
    getMenu(),
    getMenuCategories(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <Link href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </Link>
          </nav>
          <h1 className="text-3xl font-bold text-zinc-900">Кафе</h1>
          <p className="mt-2 text-zinc-600">
            Меню кафе бизнес-парка Деловой. Закажите еду с доставкой в офис.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <MenuList items={items} categories={categories} />
      </main>
    </div>
  );
}
