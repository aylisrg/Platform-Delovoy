import { prisma } from "@/lib/db";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Сообщить о неисправности — Деловой Парк",
  description:
    "Арендаторам Делового Парка — форма обращения о неисправности в офисе или общественных зонах.",
};

export default async function ReportPage() {
  const categories = await prisma.taskCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
        Сообщить о неисправности
      </h1>
      <p className="mt-2 text-zinc-600">
        Заполните форму — мы примем заявку в работу и пришлём тикет на почту.
        Если вы арендатор Делового Парка, укажите номер офиса, чтобы мы быстрее поняли, о чём речь.
      </p>
      <div className="mt-8">
        <ReportForm categories={categories} />
      </div>
    </main>
  );
}
