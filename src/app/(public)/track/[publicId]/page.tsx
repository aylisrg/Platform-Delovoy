import { getPublicTask } from "@/modules/tasks/report-service";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import TrackCommentForm from "./track-comment-form";

export const metadata = { title: "Отслеживание обращения — Деловой Парк" };

type Props = {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ email?: string }>;
};

export default async function TrackPage({ params, searchParams }: Props) {
  const { publicId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!/^TASK-[2-9A-HJ-NP-Z]{5}$/.test(publicId)) notFound();

  let data: Awaited<ReturnType<typeof getPublicTask>> = null;
  try {
    data = await getPublicTask(publicId, { email: sp.email });
  } catch {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-2xl font-semibold">Обращение {publicId}</h1>
        <p className="text-sm text-red-700">Доступ запрещён.</p>
      </main>
    );
  }

  if (!data) notFound();

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Обращение {data.publicId}</h1>
      <div className="mb-4 rounded-md border border-gray-200 p-4">
        <p className="font-medium">{data.title}</p>
        <p className="mt-2 text-sm text-gray-600">
          Статус:{" "}
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs ${
              data.columnIsTerminal
                ? "bg-green-100 text-green-800"
                : "bg-blue-100 text-blue-800"
            }`}
          >
            {data.columnName}
          </span>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Создано: {new Date(data.createdAt).toLocaleString("ru-RU")}
        </p>
        {data.closedAt && (
          <p className="text-xs text-gray-500">
            Завершено: {new Date(data.closedAt).toLocaleString("ru-RU")}
          </p>
        )}
      </div>

      {data.visibleComments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Комментарии</h2>
          {data.visibleComments.map((c, i) => (
            <article
              key={i}
              className="rounded-md border border-gray-200 bg-gray-50 p-3"
            >
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              <p className="mt-2 text-xs text-gray-500">
                {c.authorName ? `${c.authorName} · ` : ""}
                {new Date(c.createdAt).toLocaleString("ru-RU")}
              </p>
            </article>
          ))}
        </section>
      )}

      {session?.user?.id && !data.columnIsTerminal && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-medium">Добавить уточнение</h2>
          <TrackCommentForm publicId={data.publicId} />
        </section>
      )}
      {!session?.user?.id && !data.columnIsTerminal && (
        <p className="mt-6 text-xs text-gray-500">
          Чтобы добавить уточнение по обращению, войдите тем же email или Telegram, что указали при отправке.
        </p>
      )}
    </main>
  );
}
