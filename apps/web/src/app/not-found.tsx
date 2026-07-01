import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-6">
      <div className="text-center">
        <p className="text-7xl font-bold text-surface-200 mb-4">404</p>
        <h1 className="text-2xl font-bold text-surface-900 mb-2 tracking-tight">Page not found</h1>
        <p className="text-surface-500 text-[15px] mb-8 max-w-sm mx-auto">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-3 rounded-xl text-[14px] transition-colors shadow-sm shadow-brand-500/20"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
