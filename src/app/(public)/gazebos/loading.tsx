export default function GazebosLoading() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] animate-pulse">
      <div className="h-14 bg-white border-b border-black/[0.04]" />
      <div className="max-w-[1248px] mx-auto px-4 md:px-6 py-16">
        <div className="h-10 bg-zinc-200 rounded w-64 max-w-full mb-4" />
        <div className="h-5 bg-zinc-200 rounded w-96 max-w-full mb-12" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl overflow-hidden">
              <div className="aspect-[4/3] bg-zinc-200" />
              <div className="p-5">
                <div className="h-6 bg-zinc-200 rounded w-1/2 mb-3" />
                <div className="h-4 bg-zinc-200 rounded w-full mb-2" />
                <div className="h-4 bg-zinc-200 rounded w-3/4 mb-5" />
                <div className="h-10 bg-zinc-200 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
