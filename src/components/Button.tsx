import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  // Every button answers the pointer: the main button lifts a little, the others darken their fill (owner, 2026-10-01).
  primary: 'signature shadow-[0_4px_14px_rgba(31,42,85,0.22)] enabled:hover:-translate-y-px enabled:hover:shadow-[0_8px_20px_rgba(31,42,85,0.28)] enabled:hover:brightness-110',
  secondary: 'bg-fill text-ink enabled:hover:bg-fill-strong',
  plain: 'text-link enabled:hover:bg-fill',
  destructive: 'bg-fill text-late enabled:hover:bg-late-bg',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-subheadline font-semibold transition-[background-color,box-shadow,filter,transform] duration-150 disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}
