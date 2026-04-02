import { AdminHeader } from "@/components/admin/header";
import { ModuleCard } from "@/components/admin/module-card";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  const modules = await prisma.module.findMany({
    orderBy: { slug: "asc" },
  });

  return (
    <>
      <AdminHeader title="Модули" />
      <div className="p-8">
        <p className="text-sm text-zinc-500 mb-6">
          Управление модулями платформы. Каждый модуль — изолированный бизнес-сервис.
        </p>

        {modules.length === 0 ? (
          <p className="text-zinc-400">
            Модули не найдены. Запустите seed-скрипт: <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">npm run db:seed</code>
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((mod) => (
              <ModuleCard
                key={mod.id}
                name={mod.name}
                slug={mod.slug}
                description={mod.description}
                isActive={mod.isActive}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
