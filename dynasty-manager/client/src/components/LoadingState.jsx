export function SkeletonRow({ className = '' }) {
  return <div className={`shimmer h-4 w-full ${className}`} />;
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card space-y-3">
      <div className="shimmer h-3 w-32" />
      <div className="space-y-2 pt-1">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="shimmer h-3" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex flex-col items-center gap-3 py-6">
          <div className="shimmer h-16 w-16 rounded-lg" />
          <div className="shimmer h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
