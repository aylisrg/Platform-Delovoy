import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import { auth } from "@/lib/auth";
import { listBackups } from "@/modules/backups/service";
import { BackupsList } from "@/components/admin/BackupsList";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  type?: string;
  status?: string;
  offset?: string;
  limit?: string;
}>;

const KNOWN_TYPES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "PRE_MIGRATION",
  "MANUAL",
  "RESTORE",
] as const;
const KNOWN_STATUS = ["IN_PROGRESS", "SUCCESS", "FAILED", "PARTIAL"] as const;

export default async function BackupsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/admin/architect/backups");
  }
  if (session.user.role !== "SUPERADMIN") {
    redirect("/admin/forbidden");
  }

  const sp = await searchParams;
  const limit = Math.min(Number(sp.limit ?? 50) || 50, 100);
  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);

  const type =
    sp.type && (KNOWN_TYPES as readonly string[]).includes(sp.type)
      ? (sp.type as (typeof KNOWN_TYPES)[number])
      : undefined;
  const status =
    sp.status && (KNOWN_STATUS as readonly string[]).includes(sp.status)
      ? (sp.status as (typeof KNOWN_STATUS)[number])
      : undefined;

  let items: Awaited<ReturnType<typeof listBackups>>["items"] = [];
  let total = 0;
  try {
    const result = await listBackups({ type, status, limit, offset });
    items = result.items;
    total = result.total;
  } catch {
    // DB may be unavailable in dev — render empty state
  }

  return (
    <>
      <AdminHeader title="Бекапы" />
      <div className="p-8 space-y-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 space-y-1">
          <p>
            <strong>Ежедневный бекап</strong> в 02:00 MSK автоматически загружается
            в Timeweb S3. Политика: 7 daily + 4 weekly + 12 monthly.
          </p>
          <p className="text-xs text-zinc-500">
            Restore полной БД — только через CLI (см.{" "}
            <code>docs/runbooks/restore-backup.md</code>). Здесь доступны{" "}
            <em>record</em> и <em>table</em> scope с обязательным dry-run.
          </p>
        </div>

        <form
          method="GET"
          action="/admin/architect/backups"
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="offset" value="0" />
          <select
            name="type"
            defaultValue={sp.type ?? ""}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          >
            <option value="">Все типы</option>
            {KNOWN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
          >
            <option value="">Все статусы</option>
            {KNOWN_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Применить
          </button>
          <a
            href="/admin/architect/backups"
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600"
          >
            Сбросить
          </a>
        </form>

        <BackupsList items={items} total={total} />

        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Показано {items.length} из {total}
          </span>
          <div className="flex gap-2">
            {offset > 0 && (
              <a
                className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50"
                href={`/admin/architect/backups?${new URLSearchParams({
                  ...(sp.type ? { type: sp.type } : {}),
                  ...(sp.status ? { status: sp.status } : {}),
                  offset: String(Math.max(0, offset - limit)),
                  limit: String(limit),
                }).toString()}`}
              >
                Назад
              </a>
            )}
            {offset + items.length < total && (
              <a
                className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50"
                href={`/admin/architect/backups?${new URLSearchParams({
                  ...(sp.type ? { type: sp.type } : {}),
                  ...(sp.status ? { status: sp.status } : {}),
                  offset: String(offset + limit),
                  limit: String(limit),
                }).toString()}`}
              >
                Вперёд
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
