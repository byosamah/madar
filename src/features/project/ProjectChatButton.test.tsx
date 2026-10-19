import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../../test/render';

/** The grey Project chat button of the project page (chat design 2026-10-19, item 18): for the people who may open the project chat. */
const chatOf = (state: { conversations: Record<string, { id: string; kind: string; projectId: string | null }> }) =>
  Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!.id;

describe('the Project chat button', () => {
  it('shows a grey Project chat button that opens the project chat, for the people who may open it', async () => {
    const { store } = await renderApp('/projects/prj_001');
    const link = await screen.findByRole('link', { name: 'Project chat' }, { timeout: 10_000 });
    expect(link).toHaveAttribute('href', `#/inbox/${chatOf(store.state)}`);
    expect(link.className).toContain('bg-fill');
    expect(link.className).not.toContain('signature');
  });

  it('shows no Project chat button to a person off the team', async () => {
    await renderApp('/projects/prj_001', (state) => {
      const outsider = Object.values(state.users).find((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && u.id !== state.projects.prj_001.leaderId
        && !Object.values(state.members).some((m) => m.projectId === 'prj_001' && m.userId === u.id))!;
      state.session.currentUserId = outsider.id;
    });
    await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }, { timeout: 10_000 });
    expect(screen.queryByRole('link', { name: 'Project chat' })).toBeNull();
  });

  it('names the button in Arabic', async () => {
    await renderApp('/projects/prj_001', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    expect(await screen.findByRole('link', { name: 'محادثة المشروع' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
