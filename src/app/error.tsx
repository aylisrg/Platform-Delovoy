"use client";

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 text-center">
      <p className="text-red-500 font-mono text-sm tracking-widest uppercase mb-4">
        500
      </p>
      <h1 className="font-manrope text-4xl md:text-6xl font-bold text-white tracking-tighter mb-6">
        Что-то пошло не так
      </h1>
      <p className="text-zinc-400 text-lg max-w-md mb-10">
        Произошла непредвиденная ошибка. Попробуйте ещё раз или вернитесь на главную.
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="inline-flex items-center bg-[#0099ff] text-white font-semibold px-8 py-3 rounded-full hover:bg-[#0088ee] transition-colors"
        >
          Попробовать снова
        </button>
        <a
          href="/"
          className="inline-flex items-center bg-zinc-800 text-white font-semibold px-8 py-3 rounded-full hover:bg-zinc-700 transition-colors"
        >
          На главную
        </a>
      </div>
    </div>
  );
}
