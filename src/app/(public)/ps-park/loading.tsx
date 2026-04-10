export default function PSParkLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 animate-pulse">
      <div className="h-16 bg-white border-b border-zinc-100" />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="h-8 bg-zinc-200 rounded w-56 mb-2" />
        <div className="h-4 bg-zinc-200 rounded w-80 mb-10" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-12 w-12 bg-zinc-200 rounded-xl" />
                <div>
                  <div className="h-5 bg-zinc-200 rounded w-32 mb-2" />
                  <div className="h-4 bg-zinc-200 rounded w-20" />
                </div>
              </div>
              <div className="h-4 bg-zinc-200 rounded w-full mb-2" />
              <div className="h-10 bg-zinc-200 rounded-full mt-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
