import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import i18n from 'i18next';
import type { UserCard } from '../../api/contract/views';
import { initI18n } from '../../i18n';
import { ar, en } from '../../i18n/trees';
import { formatDay, setNow } from '../../lib/dates';
import { NOW } from '../../test/factories';
import { renderWithRuntime } from '../../test/render';
import type { Bubble } from './MessageBubble';
import { MessageLog } from './MessageLog';

// Base B7: the day label of the log is the hook useDayLabel (the task panel uses it in B16). Today is 2026-09-30 in the test office.
const FAISAL: UserCard = { id: 'usr_002', name: 'Faisal Al-Harbi', nameAr: 'فيصل الحربي', avatarUrl: null, kind: 'human', discipline: 'Architect' };

const bubble = (id: string, createdAt: string): Bubble => ({ id, author: FAISAL, actingFor: null, body: `Words of ${id}`, files: [], createdAt, mine: false, edited: false });

const BUBBLES = [
  bubble('old', '2026-09-27T08:00:00.000+03:00'),
  bubble('yesterday', '2026-09-29T08:00:00.000+03:00'),
  bubble('today', '2026-09-30T08:00:00.000+03:00'),
];

beforeEach(() => {
  setNow(NOW);
  initI18n('en');
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('the day labels of the message log', () => {
  it('says Today, Yesterday and the long day in English', async () => {
    await renderWithRuntime(<MessageLog bubbles={BUBBLES} resetKey="a" emptyText="Nothing yet." />);
    expect(screen.getByText(en.inbox.today)).toBeInTheDocument();
    expect(screen.getByText(en.inbox.yesterday)).toBeInTheDocument();
    expect(screen.getByText(formatDay('2026-09-27', 'en', 'long'))).toBeInTheDocument();
  });

  it('says them in Arabic when the language changes', async () => {
    await renderWithRuntime(<MessageLog bubbles={BUBBLES} resetKey="a" emptyText="Nothing yet." />);
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(screen.getByText(ar.inbox.today)).toBeInTheDocument();
    expect(screen.getByText(ar.inbox.yesterday)).toBeInTheDocument();
    expect(screen.getByText(formatDay('2026-09-27', 'ar', 'long'))).toBeInTheDocument();
    expect(screen.queryByText(en.inbox.today)).toBeNull();
  });
});
