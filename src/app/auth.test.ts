import { describe, expect, it, vi } from 'vitest';
import { alwaysSignedIn } from './auth';

describe('the prototype sign-in', () => {
  it('is always signed in, and every step succeeds without a change', async () => {
    const auth = alwaysSignedIn();
    expect(auth.status()).toBe('signed_in');
    const listener = vi.fn();
    const stop = auth.subscribe(listener);
    await auth.signIn('a@madar.test', 'pw');
    await auth.verifyLink('hash', 'invite');
    await auth.setPassword('new-password');
    await expect(auth.requestReset('nobody@madar.test')).resolves.toBeUndefined();
    await expect(auth.renewInvite('key')).resolves.toBeUndefined();
    await auth.signOut();
    expect(auth.status()).toBe('signed_in');
    expect(await auth.accessToken()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
