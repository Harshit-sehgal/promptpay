export default function AdminLoading() {
  return (
    <div>
      <div className="mb-8">
        <div className="mb-1 h-7 w-48 animate-pulse rounded bg-ink-700" />
        <div className="h-4 w-64 animate-pulse rounded bg-ink-700" />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-ink-600/30 bg-ink-800 p-6">
            <div className="mb-2 h-3 w-20 animate-pulse rounded bg-ink-600" />
            <div className="h-8 w-24 animate-pulse rounded bg-ink-600" />
          </div>
        ))}
      </div>
    </div>
  );
}
