import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-900 px-6">
      <div className="text-center">
        <p className="text-7xl font-bold text-ink-700 mb-4">404</p>
        <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Page not found</h1>
        <p className="text-ink-400 text-sm mb-8 max-w-sm mx-auto">
          This admin page doesn't exist or has been moved.
        </p>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 focus-visible:outline-none"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
