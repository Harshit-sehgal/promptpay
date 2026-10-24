import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--page)] px-6">
      <div className="text-center">
        <p className="text-7xl font-bold text-[var(--quiet)]/40 mb-4">404</p>
        <h1 className="text-2xl font-bold text-[var(--ink)] mb-2 tracking-tight">Page not found</h1>
        <p className="text-[var(--copy)] text-sm mb-8 max-w-sm mx-auto">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="bg-[var(--ink)] text-[var(--on-ink)] hover:opacity-90 font-medium px-6 py-3 rounded-xl text-sm transition-opacity"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
