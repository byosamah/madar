import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { RIGHT_SECTIONS } from '../../api/permissions';
import type { OfficeRight } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { fakeAuth } from '../auth/fakeAuth';
import { renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { OAuthProvider, type OAuthPort } from '../oauth/oauthPort';
import { without } from '../../test/rr2work';
import { AgentsSection } from './AgentsSection';

// Settings, Agents exists in the remote build only.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

/**
 * Settings, Agents with the switch Connect AI assistants (ai.connect, role rights version 2). Every ai switch needs ai.connect, so a role
 * that turns it off turns the whole section off. With it off the section shows one plain line, keeps the list of the agents of the
 * person and keeps the Remove button.
 */
const AI: OfficeRight[] = [...(RIGHT_SECTIONS.find((section) => section.key === 'ai')?.rights ?? [])];
const ROW = { agentId: 'usr_090', clientIds: ['c-1'], name: 'Claude Code', redirectHost: '127.0.0.1', approvedAt: '2026-10-01T09:00:00.000+03:00', lastUsedAt: null, active: true };

const port: OAuthPort = {
  details: vi.fn(),
  recordApproval: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  listGrants: vi.fn(async () => [{ clientId: 'c-1', clientName: 'Claude Code', grantedAt: null }]),
  revokeGrant: vi.fn(async () => undefined),
};

async function open(prepare?: (state: State) => void, language: 'en' | 'ar' = 'en') {
  const auth = fakeAuth({ accounts: Object.values(SAMPLE_ACCOUNTS).map((a) => ({ ...a })), signedInAs: SAMPLE_ACCOUNTS.faisal.email });
  const element = <OAuthProvider value={{ port, leave: vi.fn() }}><AgentsSection /></OAuthProvider>;
  return renderAuth('/settings', {
    auth,
    routes: [{ path: '*', element }],
    prepare: (state) => {
      state.session.currentUserId = 'usr_002';
      prepare?.(state);
    },
    answer: (name) => (name === 'agents.list' ? [ROW] : undefined),
    language,
  });
}

describe('Settings, Agents with ai.connect', () => {
  it('says what the section is for, and lists the agents, with the switch on', async () => {
    await open();
    expect(await screen.findByText('AI apps that act for you in Madar.')).toBeInTheDocument();
    expect(await screen.findByRole('listitem', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.queryByText('The Admin turned off AI assistants for your role.')).toBeNull();
  });

  it('shows one plain line in place of the intro with the switch off, and keeps the list and the Remove button', async () => {
    await open((state) => { state.settings.roles = without(...AI); });
    expect(await screen.findByText('The Admin turned off AI assistants for your role.')).toBeInTheDocument();
    expect(screen.queryByText('AI apps that act for you in Madar.')).toBeNull();
    const row = await screen.findByRole('listitem', { name: 'Claude Code' });
    expect(within(row).getByRole('button', { name: 'Remove Claude Code' })).toBeInTheDocument();
  });

  it('says the same line in Arabic', async () => {
    await open((state) => { state.settings.roles = without(...AI); }, 'ar');
    expect(await screen.findByText('أوقف المدير المساعدين الذكيين لدورك.')).toBeInTheDocument();
  });

  it('shows no empty-state line about a connection with the switch off and no agent', async () => {
    const auth = fakeAuth({ accounts: Object.values(SAMPLE_ACCOUNTS).map((a) => ({ ...a })), signedInAs: SAMPLE_ACCOUNTS.faisal.email });
    const element = <OAuthProvider value={{ port: { ...port, listGrants: vi.fn(async () => []) }, leave: vi.fn() }}><AgentsSection /></OAuthProvider>;
    await renderAuth('/settings', {
      auth,
      routes: [{ path: '*', element }],
      prepare: (state) => { state.session.currentUserId = 'usr_002'; state.settings.roles = without(...AI); },
      answer: (name) => (name === 'agents.list' ? [] : undefined),
    });
    expect(await screen.findByText('The Admin turned off AI assistants for your role.')).toBeInTheDocument();
    expect(screen.queryByText('No AI app is connected.')).toBeNull();
  });
});
