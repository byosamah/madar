import { AuthFailure } from '../../features/auth/authFailure';

/** The two mail requests of the sign-in screens, the same for the Supabase port and the Madar port (server/auth/forgot.ts, renew.ts). */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const postJson = async (send: Fetch, url: string, body: unknown): Promise<Response> => {
  try {
    return await send(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
  }
};

export async function requestResetAt(send: Fetch, url: string, email: string): Promise<void> {
  const response = await postJson(send, url, { email });
  if (response.status === 429) {
    // The limit of one email (server/auth/forgot.ts) has its own words: reset mails already went to it.
    const body = (await response.json().catch(() => null)) as { error?: { details?: { reason?: unknown } } } | null;
    throw new AuthFailure(body?.error?.details?.reason === 'too_many_resets_email' ? 'too_many_resets' : 'too_many');
  }
  if (!response.ok) throw new AuthFailure('failed', `The reset request failed with ${response.status}.`);
}

export async function renewInviteAt(send: Fetch, url: string, key: string): Promise<void> {
  const response = await postJson(send, url, { key });
  if (response.status === 429) throw new AuthFailure('too_many');
  if (!response.ok) throw new AuthFailure('failed', `The request for a new invitation link failed with ${response.status}.`);
}
