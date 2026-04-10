import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Страница не найдена — 404",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 text-center">
      <p className="text-[#0099ff] font-mono text-sm tracking-widest uppercase mb-4">
        404
      </p>
      <h1 className="font-manrope text-4xl md:text-6xl font-bold text-white tracking-tighter mb-6">
        Страница не найдена
      </h1>
      <p className="text-zinc-400 text-lg max-w-md mb-10">
        Такой страницы не существует или она была перемещена.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-[#0099ff] text-white font-semibold px-8 py-3 rounded-full hover:bg-[#0088ee] transition-colors"
      >
        На главную
      </Link>
    </div>
  );
}
