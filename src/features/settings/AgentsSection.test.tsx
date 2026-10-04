import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectCalm } from '../auth/calmChecks';
import { fakeAuth } from '../auth/fakeAuth';
import { renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { httpOAuthPort, OAuthProvider, type Grant, type OAuthPort } from '../oauth/oauthPort';
import { AgentsSection } from './AgentsSection';

// Settings, Agents exists in the remote build only: the prototype has no OAuth server.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

type Row = { agentId: string; clientIds: string[]; name: string; redirectHost: string | null; approvedAt: string | null; lastUsedAt: string | null; active: boolean };

const CLAUDE: Row = { agentId: 'usr_011', clientIds: ['c-1', 'c-2'], name: 'Claude Code', redirectHost: '127.0.0.1', approvedAt: '2026-10-01T09:00:00.000+03:00', lastUsedAt: '2026-10-03T10:00:00.000+03:00', active: true };
const GONE: Row = { agentId: 'usr_090', clientIds: [], name: 'Old app', redirectHost: 'old.example', approvedAt: null, lastUsedAt: null, active: false };

function setup(o: { rows?: Row[]; grants?: Grant[]; revoke?: (clientId: string) => Promise<void> } = {}) {
  let rows = (o.rows ?? [CLAUDE, GONE]).map((row) => ({ ...row }));
  const removed: string[] = [];
  const revoked: string[] = [];
  const port: OAuthPort = {
    details: vi.fn(),
    recordApproval: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    listGrants: vi.fn(async () => (o.grants ?? [{ clientId: 'c-1', clientName: 'Claude Code', grantedAt: null }, { clientId: 'c-9', clientName: 'Unknown helper', grantedAt: null }]).filter((g) => !revoked.includes(g.clientId))),
    revokeGrant: vi.fn(async (clientId: string) => {
      await o.revoke?.(clientId);
      revoked.push(clientId);
    }),
  };
  // The server answers of agents.list and agents.remove (the prototype fake has no client ids).
  const answer = (name: string, input: unknown) => {
    if (name === 'agents.list') return rows.map((row) => ({ ...row }));
    if (name === 'agents.remove') {
      const { agentId } = input as { agentId: string };
      removed.push(agentId);
      rows = rows.map((row) => (row.agentId === agentId ? { ...row, active: false, clientIds: [] } : row));
      return { removed: true };
    }
    return undefined;
  };
  return { port, answer, removed, revoked };
}

const signedIn = () => fakeAuth({ accounts: [{ ...SAMPLE_ACCOUNTS.hala }], signedInAs: SAMPLE_ACCOUNTS.hala.email });

async function open(s: ReturnType<typeof setup>, language: 'en' | 'ar' = 'en') {
  const element = <OAuthProvider value={{ port: s.port, leave: vi.fn() }}><AgentsSection /></OAuthProvider>;
  return renderAuth('/settings', { auth: signedIn(), routes: [{ path: '*', element }], answer: s.answer, language });
}

describe('Settings, Agents (plan 5.6; task G4)', () => {
  it('lists the active agents of the person with their host and last use, and an app with access that Madar has no approval for', async () => {
    const s = setup();
    const { container } = await open(s);
    const claude = await screen.findByRole('listitem', { name: 'Claude Code' });
    expect(within(claude).getByText('127.0.0.1 · Last used 3 Oct')).toBeInTheDocument();
    expect(screen.queryByText('Old app')).toBeNull();
    // c-1 belongs to Claude Code; c-9 has a grant at Auth but no agent in Madar.
    const unknown = await screen.findByRole('listitem', { name: 'Unknown helper' });
    expect(within(unknown).getByText('Has access to your account, but you did not approve it in Madar')).toBeInTheDocument();
    expectCalm(container, { titleLevel: 2 });
  });

  it('Remove turns the agent off in Madar, then revokes each of its clients at Auth', async () => {
    const s = setup();
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Claude Code' }));
    await waitFor(() => expect(s.revoked).toEqual(['c-1', 'c-2']));
    expect(s.removed).toEqual(['usr_011']);
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Claude Code' })).toBeNull());
    expect(await screen.findByText('Claude Code is removed.')).toBeInTheDocument();
  });

  it('leaves the agent off when the revoke at Auth fails, and shows one Retry that revokes only what is left', async () => {
    let failing = true;
    const s = setup({ revoke: async (clientId) => {
      if (failing && clientId === 'c-2') throw new Error('offline');
    } });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Claude Code' }));
    expect(await screen.findByText('Madar turned Claude Code off. The removal of its access to your account did not finish.')).toBeInTheDocument();
    expect(s.removed).toEqual(['usr_011']);
    expect(s.revoked).toEqual(['c-1']);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    failing = false;
    await userEvent.click(retries[0]);
    await waitFor(() => expect(s.revoked).toEqual(['c-1', 'c-2']));
    expect(s.removed).toEqual(['usr_011']);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  });

  it('clears the Retry line when the Retry finds the grant already gone at Auth (404 oauth_consent_not_found, review of G4)', async () => {
    const s = setup();
    // The real HTTP port over a fake Auth: the first revoke of c-2 is lost (500), then Auth has no grant of c-2 any more (404).
    const deletes: string[] = [];
    const grants = [{ client: { id: 'c-1', name: 'Claude Code' }, granted_at: null }];
    let c2 = 0;
    s.port = httpOAuthPort({ supabaseUrl: 'https://ref.supabase.co', publishableKey: 'pk', apiUrl: 'https://ref.supabase.co/functions/v1/api', accessToken: async () => 'tok', fetch: async (input, init) => {
      if (init?.method !== 'DELETE') return Response.json(grants.filter((g) => !deletes.includes(g.client.id)));
      const clientId = new URL(input).searchParams.get('client_id')!;
      if (clientId === 'c-2' && c2++ === 0) return Response.json({ code: 500, msg: 'Auth answered 500.' }, { status: 500 });
      if (clientId === 'c-2') return Response.json({ code: 404, error_code: 'oauth_consent_not_found', msg: 'No active grant found for this client' }, { status: 404 });
      deletes.push(clientId);
      return new Response(null, { status: 204 });
    } });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Claude Code' }));
    expect(await screen.findByText('Madar turned Claude Code off. The removal of its access to your account did not finish.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(screen.queryByText('Madar turned Claude Code off. The removal of its access to your account did not finish.')).toBeNull();
    expect(c2).toBe(2);
  });

  it('shows a failed list of grants with one Retry, and never says that no AI app is connected (review of G4)', async () => {
    const s = setup({ rows: [], grants: [] });
    let failing = true;
    const list = s.port.listGrants;
    s.port.listGrants = vi.fn(async () => {
      if (failing) throw new Error('offline');
      return list();
    });
    await open(s);
    expect(await screen.findByText('The data did not load.')).toBeInTheDocument();
    expect(screen.queryByText('No AI app is connected.')).toBeNull();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    failing = false;
    await userEvent.click(retries[0]);
    expect(await screen.findByText('No AI app is connected.')).toBeInTheDocument();
    expect(screen.queryByText('The data did not load.')).toBeNull();
  });

  it('removes an app with access but no approval at Auth only', async () => {
    const s = setup();
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Unknown helper' }));
    await waitFor(() => expect(s.revoked).toEqual(['c-9']));
    expect(s.removed).toEqual([]);
  });

  it('says so when no AI app is connected', async () => {
    await open(setup({ rows: [], grants: [] }));
    expect(await screen.findByText('No AI app is connected.')).toBeInTheDocument();
  });

  it('keeps the calm rules in Arabic, right to left', async () => {
    const { container } = await open(setup(), 'ar');
    expect(await screen.findByRole('heading', { level: 2, name: 'الوكلاء' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(await screen.findByRole('button', { name: 'إزالة Claude Code' })).toBeInTheDocument();
    expectCalm(container, { titleLevel: 2 });
  });
});
