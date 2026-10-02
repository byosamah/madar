import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

// The agenda shows the late projects first. Project prj_002 has one payment (Permit submission fee, awaiting), so the tests make it late to put it first.
// Faisal (usr_002) is a team member and may not see payments. Noura (usr_011) is Accounting.
const firstIs = (id: string) => (state: State) => {
  state.projects[id].healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};
const asUser = (id: string, userId: string) => (state: State) => {
  firstIs(id)(state);
  state.session.currentUserId = userId;
};

describe('payments in the meeting (owner, 2026-10-02)', () => {
  it.each([['Admin', 'usr_001'], ['Accounting', 'usr_011']])('shows the payments of a project to %s', async (_role, user) => {
    await renderApp(MEETING, asUser('prj_002', user));
    const article = await screen.findByRole('article');
    const region = within(await within(article).findByRole('region', { name: 'Payments' }));
    expect(await region.findByText('Permit submission fee')).toBeInTheDocument();
    expect(region.getByText('Awaiting')).toBeInTheDocument();
  });

  it('shows no payments to a team member who may not see them, and asks the server for none', async () => {
    // The failFirst hook sees every call by name. It records the payments calls and never fails one.
    const seen: string[] = [];
    const { store } = await renderApp(MEETING, asUser('prj_002', 'usr_002'), { failFirst: (name) => { seen.push(name); return false; } });
    const article = await screen.findByRole('article');
    await within(article).findByRole('region', { name: 'Latest update' });
    expect(within(article).queryByRole('region', { name: 'Payments' })).toBeNull();
    expect(article.textContent).not.toMatch(/SAR \d/);
    expect(seen).toContain('projects.get');
    expect(seen).not.toContain('payments.list');
    expect(Object.keys(store.state.payments ?? {}).length).toBeGreaterThan(0);
  });

  it('shows no payments region for a project without payments', async () => {
    await renderApp(MEETING, asUser('prj_011', 'usr_001'));
    const article = await screen.findByRole('article');
    await within(article).findByRole('region', { name: 'Latest update' });
    expect(within(article).queryByRole('region', { name: 'Payments' })).toBeNull();
  });
});
