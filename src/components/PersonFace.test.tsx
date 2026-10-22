import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import type { UserCard } from '../api/contract/views';
import { initI18n } from '../i18n';
import { fakeLive } from '../test/fakeLive';
import { renderWithRuntime } from '../test/render';
import { PersonFace } from './PersonFace';

// Each call of useTranslation (performance audit 2026-10-21, RN-10). The real hook still runs.
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

const card = (id: string, name: string, nameAr: string, gender: 'female' | 'male', kind: 'human' | 'agent' = 'human'): UserCard => (
  { id, name, nameAr, avatarUrl: null, kind, discipline: 'Architect', gender }
);
const reem = card('usr_003', 'Reem Al-Ghamdi', 'ريم الغامدي', 'female');
const lina = card('usr_007', 'Lina Mansour', 'لينا منصور', 'female');
const faisal = card('usr_002', 'Faisal Al-Harbi', 'فيصل الحربي', 'male');

const dotOf = (name: RegExp) => screen.getByRole('img', { name }).closest('[data-face]')?.querySelector('[data-presence]') ?? null;
const face = (user: UserCard, size = 40) => <span data-face><PersonFace user={user} size={size} /></span>;

describe('PersonFace', () => {
  it('draws a filled dot for online, a ring for away, and none for offline', async () => {
    const live = fakeLive({ usr_003: 'online', usr_007: 'away' });
    await renderWithRuntime(<>{face(reem)}{face(lina)}{face(faisal)}</>, undefined, { live: live.port });
    const online = dotOf(/Reem/);
    expect(online).toHaveAttribute('data-presence', 'online');
    expect(online).toHaveAttribute('aria-hidden', 'true');
    expect(online).toHaveClass('bg-green');
    const away = dotOf(/Lina/);
    expect(away).toHaveAttribute('data-presence', 'away');
    expect(away).toHaveClass('bg-panel', 'ring-ink-2');
    expect(away).not.toHaveClass('bg-green');
    expect(dotOf(/Faisal/)).toBeNull();
  });

  it('sizes the dot by the size of the face and keeps the ring of the panel color', async () => {
    const live = fakeLive({ usr_003: 'online' });
    await renderWithRuntime(
      <>{[40, 36, 28, 24].map((size) => <span key={size} data-size={size}><PersonFace user={reem} size={size} /></span>)}</>,
      undefined, { live: live.port },
    );
    for (const [size, dot] of [[40, 12], [36, 11], [28, 9], [24, 8]] as const) {
      const el = document.querySelector(`[data-size="${size}"] [data-presence]`) as HTMLElement;
      expect(el.style.width).toBe(`${dot}px`);
      expect(el.style.height).toBe(`${dot}px`);
      expect(el).toHaveClass('border-panel');
    }
  });

  it('moves with the state', async () => {
    const live = fakeLive({ usr_003: 'online' });
    await renderWithRuntime(face(reem), undefined, { live: live.port });
    expect(dotOf(/Reem/)).toHaveAttribute('data-presence', 'online');
    act(() => live.setState('usr_003', 'offline'));
    expect(dotOf(/Reem/)).toBeNull();
    act(() => live.setState('usr_003', 'away'));
    expect(dotOf(/Reem/)).toHaveAttribute('data-presence', 'away');
  });

  it('gives no dot to an agent or a person who left', async () => {
    const live = fakeLive({ usr_003: 'online', usr_009: 'online' });
    const agent = card('usr_009', 'Madar Agent', 'وكيل مدار', 'male', 'agent');
    await renderWithRuntime(<><PersonFace user={agent} size={40} /><PersonFace user={{ ...reem, active: false }} size={40} /></>, undefined, { live: live.port });
    expect(document.querySelector('[data-presence]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Madar Agent' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Reem Al-Ghamdi' })).toBeInTheDocument();
  });

  it('shows the state of the own person when it is mine', async () => {
    const live = fakeLive({ usr_001: 'away' });
    const hala = card('usr_001', 'Hala Nasser', 'هالة ناصر', 'female');
    await renderWithRuntime(<PersonFace user={hala} size={36} mine />, undefined, { live: live.port });
    expect(await screen.findByRole('img', { name: 'Hala Nasser, Away' })).toBeInTheDocument();
    expect(document.querySelector('[data-presence="away"]')).not.toBeNull();
  });

  it('shows nothing extra when the screen has no live port', async () => {
    await renderWithRuntime(<PersonFace user={reem} size={40} />);
    expect(screen.getByRole('img', { name: 'Reem Al-Ghamdi' })).toBeInTheDocument();
    expect(document.querySelector('[data-presence]')).toBeNull();
  });

  it('says the state in the label, in English and in Arabic with the female form', async () => {
    const live = fakeLive({ usr_003: 'online', usr_002: 'away', usr_007: 'offline' });
    await renderWithRuntime(<><PersonFace user={reem} size={40} /><PersonFace user={faisal} size={40} /><PersonFace user={lina} size={40} /></>, undefined, { live: live.port });
    expect(screen.getByRole('img', { name: 'Reem Al-Ghamdi, Online' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi, Away' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lina Mansour, Offline' })).toBeInTheDocument();
    await act(async () => { initI18n('ar'); });
    expect(await screen.findByRole('img', { name: 'ريم الغامدي، متصلة' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'فيصل الحربي، بعيد عن الشاشة' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'لينا منصور، غير متصلة' })).toBeInTheDocument();
  });

  it('adds no useTranslation call for each face (RN-10)', async () => {
    const people = Array.from({ length: 30 }, (_, i) => card(`usr_${100 + i}`, `Person ${i}`, `شخص ${i}`, i % 2 ? 'female' : 'male'));
    const states = Object.fromEntries(people.map((p, i) => [p.id, i % 3 === 0 ? 'online' : 'away'] as const));
    const live = fakeLive(states);
    translations.calls = 0;
    await renderWithRuntime(<PersonFace user={people[0]!} size={40} />, undefined, { live: live.port });
    const base = translations.calls;
    cleanup();
    translations.calls = 0;
    await renderWithRuntime(<>{people.map((p) => <PersonFace key={p.id} user={p} size={40} />)}</>, undefined, { live: live.port });
    expect(screen.getByRole('img', { name: 'Person 0, Online' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Person 1, Away' })).toBeInTheDocument();
    expect(translations.calls).toBe(base);
  });

  it('gives a new language to the label of a face that holds no hook (RN-10)', async () => {
    const live = fakeLive({ usr_003: 'online' });
    await renderWithRuntime(<PersonFace user={reem} size={40} />, undefined, { live: live.port });
    expect(screen.getByRole('img', { name: 'Reem Al-Ghamdi, Online' })).toBeInTheDocument();
    await act(async () => { initI18n('ar'); });
    expect(await screen.findByRole('img', { name: 'ريم الغامدي، متصلة' })).toBeInTheDocument();
    await act(async () => { initI18n('en'); });
    expect(await screen.findByRole('img', { name: 'Reem Al-Ghamdi, Online' })).toBeInTheDocument();
  });
});
