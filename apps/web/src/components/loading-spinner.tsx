export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-2',
    lg: 'h-12 w-12 border-3',
  };

  const label =
    size === 'sm'
      ? 'Loading content'
      : size === 'lg'
        ? 'Loading page, please wait...'
        : 'Loading data, please wait...';

  return (
    <div
      className="flex items-center justify-center py-20"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-brand-600 border-t-transparent motion-reduce:animate-none`}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
