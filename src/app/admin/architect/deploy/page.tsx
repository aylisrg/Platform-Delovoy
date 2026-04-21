import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { auth } from "@/lib/auth";
import { DeployStagingForm } from "@/components/admin/DeployStagingForm";

export const dynamic = "force-dynamic";

export default async function DeployStagingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/admin/architect/deploy");
  }
  if (session.user.role !== "SUPERADMIN") {
    redirect("/admin/forbidden");
  }

  return (
    <>
      <AdminHeader title="Деплой на Staging" />
      <div className="p-8 space-y-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 space-y-1">
          <p>
            Запускает GitHub Action{" "}
            <code className="text-xs">deploy-staging.yml</code>. Образ уже собран
            в CI — просто перетегируется и раскатывается на{" "}
            <a
              href="https://staging.delovoy-park.ru"
              className="text-blue-600 underline"
              target="_blank"
              rel="noreferrer"
            >
              staging.delovoy-park.ru
            </a>
            .
          </p>
          <p className="text-xs text-zinc-500">
            Время деплоя: p50 ~1:10, p95 &lt;3 мин. Uses GITHUB_DISPATCH_TOKEN —
            если отсутствует в прод .env, сервер вернёт 500.
          </p>
        </div>

        <DeployStagingForm />

        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm space-y-2">
          <h3 className="font-semibold text-zinc-900">Полезные ссылки</h3>
          <ul className="list-disc pl-5 text-zinc-600 text-sm space-y-1">
            <li>
              <a
                href="https://github.com/aylisrg/platform-delovoy/actions/workflows/deploy-staging.yml"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline"
              >
                История деплоев на staging
              </a>
            </li>
            <li>
              <a
                href="https://staging.delovoy-park.ru/api/health"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline"
              >
                /api/health staging
              </a>
            </li>
            <li>
              <code className="text-xs">docs/staging-setup.md</code> — full setup
              guide
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
