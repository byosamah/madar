import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-fill text-on-accent',
  secondary: 'bg-fill text-label',
  plain: 'text-accent',
  destructive: 'bg-fill text-red-text',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-semibold disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}
