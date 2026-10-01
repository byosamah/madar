import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';

const LENGTH = 25 * 60 * 1000;

function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** An optional 25-minute timer. It counts in the page only, saves nothing and makes no sound (redesign spec 5.1). */
export function FocusTimer() {
  const { t } = useTranslation();
  const gradient = useId();
  const [left, setLeft] = useState(LENGTH);
  const [endAt, setEndAt] = useState<number | null>(null);
  useEffect(() => {
    if (endAt === null) return;
    const tick = () => {
      const next = Math.max(0, endAt - Date.now());
      setLeft(next);
      if (next === 0) setEndAt(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [endAt]);
  const running = endAt !== null;
  const r = 52;
  const length = 2 * Math.PI * r;
  return (
    <section aria-label={t('focus.timer')} className="flex flex-col items-center gap-3">
      <div className="relative grid size-32 place-items-center">
        <svg viewBox="0 0 120 120" aria-hidden className="absolute inset-0 -rotate-90">
          <defs>
            <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="var(--sig-from)" />
              <stop offset="1" stopColor="var(--sig-to)" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--c-fill-strong)" strokeWidth="6" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={`url(#${gradient})`} strokeWidth="6" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - left / LENGTH)} />
        </svg>
        <span role="timer" aria-live="off" className="tabular text-title-2 font-semibold text-ink">{clock(left)}</span>
      </div>
      <div className="flex gap-2">
        {running
          ? <Button onClick={() => { setLeft(Math.max(0, (endAt ?? 0) - Date.now())); setEndAt(null); }}>{t('focus.pause')}</Button>
          : <Button disabled={left === 0} onClick={() => setEndAt(Date.now() + left)}>{t('focus.start')}</Button>}
        <Button variant="plain" onClick={() => { setEndAt(null); setLeft(LENGTH); }}>{t('focus.reset')}</Button>
      </div>
      {left === 0 && <p role="status" className="text-subheadline font-medium text-ink">{t('focus.break')}</p>}
    </section>
  );
}
