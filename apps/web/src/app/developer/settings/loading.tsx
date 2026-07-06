export default function SettingsLoading() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="mb-2 h-8 w-36 animate-pulse rounded bg-surface-200" />
        <div className="h-4 w-56 animate-pulse rounded bg-surface-200" />
      </div>

      <div className="space-y-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-surface-200/80 bg-white p-7 shadow-sm">
            <div className="mb-5 h-5 w-32 animate-pulse rounded bg-surface-200" />
            <div className="space-y-6">
              {[1, 2].map((j) => (
                <div key={j} className="flex items-center justify-between">
                  <div>
                    <div className="h-4 w-36 animate-pulse rounded bg-surface-200" />
                    <div className="mt-0.5 h-3 w-48 animate-pulse rounded bg-surface-200" />
                  </div>
                  <div className="h-6 w-11 animate-pulse rounded-full bg-surface-200" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
