import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

/** A 36 px ring in the signature gradient: what I finished today against what today asks (redesign spec 5.2). */
export function DayRing({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const gradient = useId();
  const reduce = useReducedMotion();
  if (total === 0) return null;
  const r = 15;
  const length = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        width="36" height="36" viewBox="0 0 36 36" role="progressbar"
        aria-label={t('home.ringLabel', { done, total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        className="shrink-0 -rotate-90"
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sig-from)" />
            <stop offset="1" stopColor="var(--sig-to)" />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--c-fill-strong)" strokeWidth="4" />
        <motion.circle
          cx="18" cy="18" r={r} fill="none" stroke={`url(#${gradient})`} strokeWidth="4" strokeLinecap="round" strokeDasharray={length}
          initial={{ strokeDashoffset: length }}
          animate={{ strokeDashoffset: length * (1 - done / total) }}
          transition={{ duration: reduce ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <span aria-hidden className="tabular text-subheadline font-semibold text-ink">{t('home.ringText', { done, total })}</span>
    </span>
  );
}
