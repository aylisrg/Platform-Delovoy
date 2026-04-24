import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CategoriesPanel } from "@/components/admin/tasks/categories-panel";
import { getGlobalFallbackAssignee } from "@/modules/tasks/routing";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/admin/forbidden");
  if (session.user.role !== "SUPERADMIN") redirect("/admin/forbidden");

  const [categories, assignees, fallback] = await Promise.all([
    prisma.taskCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        defaultAssignee: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    getGlobalFallbackAssignee(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <Link
        href="/admin/tasks"
        className="text-sm text-zinc-500 hover:text-zinc-900"
      >
        ← К задачам
      </Link>
      <h1 className="text-2xl font-semibold text-zinc-900">Категории и маршрутизация</h1>
      <p className="text-sm text-zinc-500">
        Каждая категория может иметь ответственного по умолчанию — именно ему будет прилетать
        уведомление о новой жалобе. Если категория не задана или ответственного нет — задача
        летит глобальному «дежурному».
      </p>
      <CategoriesPanel
        categories={categories.map((c: (typeof categories)[number]) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          isActive: c.isActive,
          keywords: c.keywords,
          sortOrder: c.sortOrder,
          defaultAssignee: c.defaultAssignee,
        }))}
        assignees={assignees}
        initialFallbackId={fallback}
      />
    </div>
  );
}
