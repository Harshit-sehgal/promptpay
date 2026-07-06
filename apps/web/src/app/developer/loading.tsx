export default function DeveloperLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 h-4 w-20 animate-pulse rounded bg-surface-200" />
          <div className="h-8 w-48 animate-pulse rounded bg-surface-200" />
          <div className="mt-2 h-4 w-96 animate-pulse rounded bg-surface-200" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-surface-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 h-4 w-24 animate-pulse rounded bg-surface-200" />
            <div className="h-8 w-32 animate-pulse rounded bg-surface-200" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-surface-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
