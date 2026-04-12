import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="text-center">
        <div className="text-6xl font-bold text-zinc-200">403</div>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900">
          Доступ запрещён
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          У вас нет прав доступа к этому разделу.
          <br />
          Обратитесь к администратору для получения доступа.
        </p>
        <p className="mt-3 text-xs text-zinc-400">
          Охранник сказал нет — значит, нет.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Link
            href="/"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
