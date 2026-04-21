import Link from "next/link";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { forbidden } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RentalEmailTemplatesPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "SUPERADMIN") forbidden();

  const templates = await prisma.emailTemplate.findMany({
    where: { moduleSlug: "rental" },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <AdminHeader title="Аренда — шаблоны писем" />
      <div className="p-6 lg:p-8 max-w-5xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-zinc-900">Шаблоны</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Системные шаблоны можно редактировать, но нельзя удалить.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-100">
              {templates.map((t) => (
                <div key={t.key} className="py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/rental/email-templates/${encodeURIComponent(t.key)}`}
                        className="font-medium text-zinc-900 hover:text-blue-600"
                      >
                        {t.name}
                      </Link>
                      {t.isSystem && <Badge variant="info">системный</Badge>}
                      {!t.isActive && <Badge variant="default">выключен</Badge>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 font-mono">{t.key}</p>
                    <p className="text-sm text-zinc-600 mt-1">{t.subject}</p>
                  </div>
                  <Link
                    href={`/admin/rental/email-templates/${encodeURIComponent(t.key)}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Редактировать →
                  </Link>
                </div>
              ))}
              {templates.length === 0 && (
                <p className="text-sm text-zinc-400 py-8 text-center">
                  Шаблоны ещё не созданы. Запустите миграцию с сидом.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
