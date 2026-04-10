export default function CafeLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 animate-pulse">
      <div className="h-16 bg-white border-b border-zinc-100" />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="h-8 bg-zinc-200 rounded w-48 mb-2" />
        <div className="h-4 bg-zinc-200 rounded w-72 mb-10" />
        <div className="flex gap-2 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 bg-zinc-200 rounded-full w-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="h-40 bg-zinc-200 rounded-xl mb-4" />
              <div className="h-5 bg-zinc-200 rounded w-3/4 mb-2" />
              <div className="h-4 bg-zinc-200 rounded w-full mb-4" />
              <div className="flex justify-between items-center">
                <div className="h-6 bg-zinc-200 rounded w-16" />
                <div className="h-9 bg-zinc-200 rounded-full w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
