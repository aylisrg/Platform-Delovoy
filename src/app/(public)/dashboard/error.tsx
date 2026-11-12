"use client";

import Link from "next/link";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-24">
      <h1 className="text-2xl font-semibold">Не удалось загрузить кабинет</h1>
      <p role="alert" className="mt-3 text-sm leading-relaxed text-zinc-600">
        Данные сейчас недоступны. Попробуйте ещё раз через несколько секунд.
      </p>
      <button
        onClick={reset}
        className="mt-6 min-h-11 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white"
      >
        Повторить загрузку
      </button>
      <Link
        href="/"
        className="ml-4 inline-flex min-h-11 items-center text-sm text-blue-700"
      >
        На главную
      </Link>
    </main>
  );
}
