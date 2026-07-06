export default function TrustLoading() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="mb-2 h-8 w-40 animate-pulse rounded bg-surface-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-surface-200" />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-surface-200/80 bg-white p-6 shadow-sm">
            <div className="mb-2 h-3 w-20 animate-pulse rounded bg-surface-200" />
            <div className="h-7 w-24 animate-pulse rounded bg-surface-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
