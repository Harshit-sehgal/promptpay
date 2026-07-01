import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-900 px-6">
      <div className="text-center">
        <p className="text-6xl font-bold text-ink-600 mb-4">404</p>
        <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
        <p className="text-ink-300 text-sm mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-3 rounded-lg transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
