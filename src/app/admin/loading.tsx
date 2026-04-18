export default function AdminLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Page title skeleton */}
      <div className="space-y-2">
        <div className="h-7 w-48 bg-zinc-200 rounded-lg" />
        <div className="h-4 w-72 bg-zinc-100 rounded" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 space-y-3">
            <div className="h-4 w-24 bg-zinc-100 rounded" />
            <div className="h-8 w-16 bg-zinc-200 rounded" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100">
          <div className="h-5 w-32 bg-zinc-200 rounded" />
        </div>
        <div className="divide-y divide-zinc-100">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center gap-4">
              <div className="h-4 w-4 bg-zinc-100 rounded" />
              <div className="h-4 flex-1 bg-zinc-100 rounded" />
              <div className="h-4 w-24 bg-zinc-100 rounded" />
              <div className="h-6 w-16 bg-zinc-100 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
