export default function RentalLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 animate-pulse">
      <div className="h-16 bg-white border-b border-zinc-100" />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="h-8 bg-zinc-200 rounded w-48 mb-2" />
        <div className="h-4 bg-zinc-200 rounded w-80 mb-10" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="h-7 bg-zinc-200 rounded w-24" />
                <div className="h-6 bg-zinc-200 rounded-full w-16" />
              </div>
              <div className="h-4 bg-zinc-200 rounded w-3/4 mb-2" />
              <div className="h-4 bg-zinc-200 rounded w-1/2 mb-5" />
              <div className="h-6 bg-zinc-200 rounded w-28 mb-4" />
              <div className="h-10 bg-zinc-200 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
