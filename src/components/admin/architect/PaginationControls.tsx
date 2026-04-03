"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type Props = {
  total: number;
  offset: number;
  limit: number;
};

export function PaginationControls({ total, offset, limit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  function navigate(newOffset: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("offset", String(newOffset));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between pt-4 text-sm text-zinc-600">
      <span>
        Страница {currentPage} из {totalPages} ({total} записей)
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="rounded border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Назад
        </button>
        <button
          onClick={() => navigate(offset + limit)}
          disabled={offset + limit >= total}
          className="rounded border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}
