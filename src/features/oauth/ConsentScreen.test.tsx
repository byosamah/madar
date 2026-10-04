import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../api/errors';
import { expectCalm } from '../auth/calmChecks';
import { fakeAuth } from '../auth/fakeAuth';
import { AUTH_ROUTES, renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { ConsentScreen } from './ConsentScreen';
import { OAuthProvider, type ConsentDetails, type OAuthPort } from './oauthPort';

// The consent screen exists in the remote build only (path links, a real sign-in).
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

const LOOPBACK = 'http://127.0.0.1:33418/callback';
const UNKNOWN = 'https://evil.example/callback';

function tools(o: { redirectUri?: string; details?: ConsentDetails; record?: () => Promise<void> } = {}) {
  const steps: string[] = [];
  const port: OAuthPort = {
    details: vi.fn(async (id: string) => {
      steps.push(`details ${id}`);
      return o.details ?? { kind: 'ask' as const, request: { authorizationId: id, clientId: 'c1', clientName: 'Claude Code', redirectUri: o.redirectUri ?? LOOPBACK } };
    }),
    recordApproval: vi.fn(async (id: string) => {
      steps.push(`record ${id}`);
      await o.record?.();
    }),
    approve: vi.fn(async (id: string) => {
      steps.push(`approve ${id}`);
      return 'http://127.0.0.1:33418/callback?code=yes';
    }),
    deny: vi.fn(async (id: string) => {
      steps.push(`deny ${id}`);
      return 'http://127.0.0.1:33418/callback?error=access_denied';
    }),
    listGrants: vi.fn(async () => []),
    revokeGrant: vi.fn(async () => undefined),
  };
  const leave = vi.fn((url: string) => void steps.push(`leave ${url}`));
  return { port, leave, steps };
}

const signedIn = () => fakeAuth({ accounts: Object.values(SAMPLE_ACCOUNTS).map((a) => ({ ...a })), signedInAs: SAMPLE_ACCOUNTS.hala.email });

async function open(o: { tools?: ReturnType<typeof tools>; auth?: ReturnType<typeof fakeAuth>; path?: string; language?: 'en' | 'ar' } = {}) {
  const t = o.tools ?? tools();
  const routes = [{ path: '/oauth/consent', element: <OAuthProvider value={{ port: t.port, leave: t.leave }}><ConsentScreen /></OAuthProvider> }, ...AUTH_ROUTES];
  const view = await renderAuth(o.path ?? '/oauth/consent?authorization_id=auth-1', { auth: o.auth ?? signedIn(), routes, language: o.language });
  return { ...view, ...t };
}

describe('the agent consent screen (plan 5.6; task G4)', () => {
  it('Approve records the approval in Madar first, then approves at Auth, then goes back to the AI app', async () => {
    const { steps } = await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(steps).toEqual(['details auth-1', 'record auth-1', 'approve auth-1', 'leave http://127.0.0.1:33418/callback?code=yes']));
  });

  it('Deny denies at Auth and goes back, with no approval in Madar', async () => {
    const { steps, port } = await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(steps).toEqual(['details auth-1', 'deny auth-1', 'leave http://127.0.0.1:33418/callback?error=access_denied']));
    expect(port.recordApproval).not.toHaveBeenCalled();
    expect(port.approve).not.toHaveBeenCalled();
  });

  it('never approves at Auth when Madar refuses the approval, and says why', async () => {
    const { port, leave } = await open({ tools: tools({ record: () => Promise.reject(new ApiError('invalid_input', 'Ended.', { reason: 'authorization_ended' })) }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This request ended. Start the connection again in your AI app.');
    expect(port.approve).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
  });

  it('sends a person with no session to Sign in, and brings them back with the same authorization_id', async () => {
    const auth = fakeAuth({ accounts: [{ ...SAMPLE_ACCOUNTS.hala }] });
    const { router, port } = await open({ auth, path: '/oauth/consent?authorization_id=abc%2F1' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/oauth/consent?authorization_id=abc%2F1');
    expect(port.details).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Email'), SAMPLE_ACCOUNTS.hala.email);
    await userEvent.type(screen.getByLabelText('Password'), SAMPLE_ACCOUNTS.hala.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { level: 1, name: 'Connect Claude Code to Madar?' });
    expect(router.state.location.pathname).toBe('/oauth/consent');
    expect(port.details).toHaveBeenCalledWith('abc/1');
  });

  it('warns about a redirect host that is not loopback and not a known AI app, and then offers no main button', async () => {
    const { container } = await open({ tools: tools({ redirectUri: UNKNOWN }) });
    expect(await screen.findByText('Madar does not know evil.example. Approve only if you started this connection yourself, in an AI app you trust.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveClass('signature');
    expectCalm(container);
  });

  it('shows no warning for a loopback or known host, and Approve is the one main button', async () => {
    for (const redirectUri of [LOOPBACK, 'https://claude.ai/api/mcp/auth_callback']) {
      const { container, unmount } = await open({ tools: tools({ redirectUri }) });
      expect(await screen.findByRole('button', { name: 'Approve' })).toHaveClass('signature');
      expect(screen.queryByText(/Madar does not know/)).toBeNull();
      expectCalm(container);
      unmount();
    }
  });

  it('says in plain words what the agent may do, who is signed in, and where the answer goes', async () => {
    await open({ tools: tools({ redirectUri: 'https://claude.ai/api/mcp/auth_callback' }) });
    expect(await screen.findByText('Signed in as Hala Nasser')).toBeInTheDocument();
    expect(screen.getByText('After you answer, Madar sends you back to claude.ai.')).toBeInTheDocument();
    for (const line of [
      'acts with your rights, so it can see and change what you can',
      'shows its name and yours on each change, and you can undo its changes',
      'can also use your account outside the Madar screens, for example to change your password',
      'keeps this access until you remove it in Settings, Agents',
    ]) expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('goes straight back for a client that the person approved before, with no new approval in Madar', async () => {
    const { steps, port } = await open({ tools: tools({ details: { kind: 'done', redirectUrl: 'http://127.0.0.1:33418/callback?code=again' } }) });
    await waitFor(() => expect(steps).toEqual(['details auth-1', 'leave http://127.0.0.1:33418/callback?code=again']));
    expect(port.recordApproval).not.toHaveBeenCalled();
    expect(screen.getByText('Madar is sending you back to your AI app.')).toBeInTheDocument();
  });

  it('says so when the link has no authorization_id', async () => {
    const { port } = await open({ path: '/oauth/consent' });
    expect(await screen.findByText('This link is not complete. Start the connection again in your AI app.')).toBeInTheDocument();
    expect(port.details).not.toHaveBeenCalled();
  });

  it('keeps the calm rules in Arabic, right to left, with the warning', async () => {
    const { container } = await open({ tools: tools({ redirectUri: UNKNOWN }), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'هل تربط Claude Code بمدار؟' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(/لا يعرف مدار العنوان/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expectCalm(container);
  });
});
