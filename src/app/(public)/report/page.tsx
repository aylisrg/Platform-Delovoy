import ReportForm from "./report-form";
import { prisma } from "@/lib/db";

export const metadata = {
  title: "Сообщить о проблеме — Деловой Парк",
};

export default async function ReportPage() {
  const categories = await prisma.taskCategory.findMany({
    where: { isArchived: false },
    select: { slug: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Сообщить о проблеме</h1>
      <p className="mb-6 text-sm text-gray-600">
        Опишите ситуацию — администратор парка получит обращение и свяжется с вами.
      </p>
      <ReportForm categories={categories} />
    </main>
  );
}
