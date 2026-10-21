import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { UserCard } from '../api/contract/views';
import { initI18n } from '../i18n';
import { fakeLive } from '../test/fakeLive';
import { renderWithRuntime } from '../test/render';
import { PersonFace } from './PersonFace';

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
});
