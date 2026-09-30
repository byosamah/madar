export function Badge({ count, label, className = '' }: { count: number; label: string; className?: string }) {
  return (
    <span className={`tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-badge px-1.5 text-caption font-semibold text-white ${className}`}>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
