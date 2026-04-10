export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 animate-pulse">
      <div className="h-16 bg-white border-b border-zinc-100" />
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="h-8 bg-zinc-200 rounded w-48 mb-8" />
        <div className="flex gap-2 mb-8">
          {[1, 2].map((i) => (
            <div key={i} className="h-9 bg-zinc-200 rounded-full w-28" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="h-5 bg-zinc-200 rounded w-36 mb-2" />
                  <div className="h-4 bg-zinc-200 rounded w-24" />
                </div>
                <div className="h-6 bg-zinc-200 rounded-full w-20" />
              </div>
              <div className="h-4 bg-zinc-200 rounded w-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
