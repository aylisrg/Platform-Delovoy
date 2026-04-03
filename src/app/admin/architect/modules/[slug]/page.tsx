import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { ModuleConfigPanel } from "@/components/admin/architect/ModuleConfigPanel";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ModuleConfigPage({ params }: Props) {
  const { slug } = await params;

  let mod: Awaited<ReturnType<typeof prisma.module.findUnique>> = null;
  try {
    mod = await prisma.module.findUnique({ where: { slug } });
  } catch {
    // DB unavailable
  }

  if (!mod) {
    notFound();
  }

  const config =
    mod.config && typeof mod.config === "object" && !Array.isArray(mod.config)
      ? (mod.config as Record<string, unknown>)
      : {};

  return (
    <>
      <AdminHeader title={`Конфиг: ${mod.name}`} />
      <div className="p-8">
        <div className="mb-6">
          <a
            href="/admin/architect"
            className="text-sm text-zinc-400 hover:text-zinc-700"
          >
            ← Карта системы
          </a>
        </div>
        <ModuleConfigPanel
          moduleId={mod.id}
          slug={mod.slug}
          name={mod.name}
          isActive={mod.isActive}
          config={config}
        />
      </div>
    </>
  );
}
