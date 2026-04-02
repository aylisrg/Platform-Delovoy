import { listTables } from "@/modules/ps-park/service";
import { TableList } from "@/components/public/ps-park/table-list";
import { PSAvailability } from "@/components/public/ps-park/ps-availability";

export const dynamic = "force-dynamic";

export default async function PSParkPage() {
  const tables = await listTables(true);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <nav className="mb-4">
            <a href="/" className="text-sm text-blue-600 hover:underline">
              ← Главная
            </a>
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
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Проверить доступность</h2>
          <PSAvailability />
        </section>
      </main>
    </div>
  );
}
