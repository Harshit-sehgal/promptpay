export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-2',
    lg: 'h-12 w-12 border-3',
  };

  return (
    <div className="flex items-center justify-center py-20" role="status" aria-live="polite" aria-busy="true">
      <div
        className={`animate-spin ${sizeClasses[size]} border-brand-500 border-t-transparent rounded-full`}
      />
      <span className="sr-only">Loading {size === 'sm' ? 'content' : size === 'lg' ? 'page, please wait...' : 'data, please wait...'}</span>
    </div>
  );
}
