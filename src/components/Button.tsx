import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  primary: 'signature shadow-[0_4px_14px_rgba(31,42,85,0.22)]',
  secondary: 'bg-fill text-ink',
  plain: 'text-link',
  destructive: 'bg-fill text-late',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-subheadline font-semibold disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}
