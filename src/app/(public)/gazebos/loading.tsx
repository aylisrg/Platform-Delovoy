export default function GazebosLoading() {
  return (
    <div className="min-h-screen bg-black animate-pulse">
      <div className="h-16 bg-zinc-900 border-b border-zinc-800" />
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="h-10 bg-zinc-800 rounded w-64 mb-4" />
        <div className="h-5 bg-zinc-800 rounded w-96 mb-12" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-2xl overflow-hidden">
              <div className="h-52 bg-zinc-800" />
              <div className="p-5">
                <div className="h-6 bg-zinc-800 rounded w-1/2 mb-3" />
                <div className="h-4 bg-zinc-800 rounded w-full mb-2" />
                <div className="h-4 bg-zinc-800 rounded w-3/4 mb-5" />
                <div className="h-10 bg-zinc-800 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
