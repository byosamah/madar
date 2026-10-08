import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initI18n } from '../i18n';
import { Avatar } from '../components/Avatar';
import { formatDay } from '../lib/dates';
import { useLang } from './lang';

// Each call of useTranslation (performance audit 2026-10-07, RND-8). The real hook still runs.
const translations = vi.hoisted(() => ({ calls: 0 }));
vi.mock('react-i18next', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-i18next')>();
  return {
    ...real,
    useTranslation: (...args: Parameters<typeof real.useTranslation>) => {
      translations.calls += 1;
      return real.useTranslation(...args);
    },
  };
});

const faisal = { id: 'usr_002', name: 'Faisal Al-Harbi', nameAr: 'فيصل الحربي', avatarUrl: null, kind: 'human' as const };

function Day() {
  return <p>{formatDay('2026-09-30', useLang(), 'weekday')}</p>;
}

beforeEach(() => {
  initI18n('en');
  translations.calls = 0;
});
afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('useLang (performance audit 2026-10-07, RND-8)', () => {
  it('gives the new language to a person picture and a date at once', async () => {
    render(<><Avatar user={faisal} /><Day /></>);
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    const english = screen.getByText(/30 September/).textContent;
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(screen.getByRole('img', { name: 'فيصل الحربي' })).toBeInTheDocument();
    expect(screen.queryByText(english ?? '')).toBeNull();
    expect(screen.getByText(formatDay('2026-09-30', 'ar', 'weekday'))).toBeInTheDocument();
  });

  it('reads the language without useTranslation', () => {
    render(<Avatar user={faisal} />);
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    expect(translations.calls).toBe(0);
  });
});
