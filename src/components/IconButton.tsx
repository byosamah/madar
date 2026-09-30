import type { ButtonHTMLAttributes } from 'react';

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill disabled:opacity-40 ${className}`}
    />
  );
}
