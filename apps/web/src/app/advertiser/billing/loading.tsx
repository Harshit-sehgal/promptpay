export default function BillingLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-7 w-24 bg-ink-700 rounded-lg mb-2" />
        <div className="h-4 w-64 bg-ink-700 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <div className="h-3 w-24 bg-ink-700 rounded mb-3" />
            <div className="h-8 w-32 bg-ink-700 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
        <div className="h-5 w-32 bg-ink-700 rounded mb-4" />
        <div className="h-10 w-48 bg-ink-700 rounded-lg mb-4" />
        <div className="h-4 w-72 bg-ink-700 rounded" />
      </div>
      <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
        <div className="h-5 w-40 bg-ink-700 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-ink-700/50 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
