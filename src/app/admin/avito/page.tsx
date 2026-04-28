import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  hasAdminSectionAccess,
  getUserModules,
} from "@/lib/permissions";
import {
  getAccountSnapshot,
  isAvitoCredentialsConfigured,
  listAvitoItems,
} from "@/lib/avito";
import { AdminHeader } from "@/components/admin/header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { itemsToDto } from "@/app/api/avito/items/_dto";
import { AvitoItemsTable } from "./_components/items-table";
import { BalanceCard } from "./_components/balance-card";
import { NotConfiguredCard } from "./_components/not-configured";

export const dynamic = "force-dynamic";

export default async function AvitoDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  const role = session.user.role;
  if (role === "USER") redirect("/admin/forbidden");

  const isSuper = role === "SUPERADMIN";
  if (!isSuper) {
    const allowed = await hasAdminSectionAccess(session.user.id, "avito");
    if (!allowed) redirect("/admin/forbidden");
  }

  const configured = isAvitoCredentialsConfigured();
  const account = configured ? await getAccountSnapshot() : null;
  const items = configured ? await listAvitoItems({ period: "7d" }) : [];

  let visibleItems = items;
  if (!isSuper) {
    const myModules = new Set(await getUserModules(session.user.id));
    visibleItems = items.filter((it) => !it.moduleSlug || myModules.has(it.moduleSlug));
  }

  const itemsDto = itemsToDto(visibleItems, "7d");

  // Module options for the assignment select (SUPERADMIN only).
  const moduleOptions = isSuper
    ? await prisma.module.findMany({
        where: { isActive: true, slug: { in: ["gazebos", "ps-park"] } },
        select: { slug: true, name: true },
      })
    : [];

  return (
    <>
      <AdminHeader title="Деловой Авито" />
      <div className="p-4 lg:p-8 space-y-6">
        <p className="text-sm text-zinc-500">
          Все объявления Авито аккаунта парка в одном месте. Метрики обновляются раз в 15&nbsp;минут;
          можно нажать «Обновить» для немедленной синхронизации.{" "}
          <Link href="https://developers.avito.ru/api-catalog" target="_blank" className="text-blue-600 hover:underline">
            Документация Avito API →
          </Link>
        </p>

        {!configured ? (
          <NotConfiguredCard />
        ) : (
          <>
            {isSuper && account && <BalanceCard account={account} />}
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-zinc-900">Объявления</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {itemsDto.length === 0
                    ? "Пока нет объявлений в реестре. Запустите cron `/api/cron/avito-account-sync`, чтобы импортировать."
                    : `Объявлений в реестре: ${itemsDto.length}`}
                </p>
              </CardHeader>
              <CardContent>
                <AvitoItemsTable
                  items={itemsDto}
                  isSuperadmin={isSuper}
                  moduleOptions={moduleOptions}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
