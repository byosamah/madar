import { describe, expect, it } from 'vitest';
import { safeNext, signInPath } from './paths';

describe('the link after sign-in (plan U2)', () => {
  it('keeps a path inside Madar, also the agent consent screen that sent the person to sign in', () => {
    expect(safeNext('/projects?filter=late')).toBe('/projects?filter=late');
    expect(safeNext('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc');
  });

  it('goes Home for another site, a missing link, or a sign-in screen again', () => {
    for (const next of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', '/sign-in?next=/x', '/welcome', '/forgot', '/reset?token_hash=x']) {
      expect(safeNext(next)).toBe('/');
    }
  });

  it('builds the sign-in link with the place to come back to and the reason', () => {
    expect(signInPath()).toBe('/sign-in');
    expect(signInPath({ next: '/projects?filter=late' })).toBe('/sign-in?next=%2Fprojects%3Ffilter%3Dlate');
    expect(signInPath({ next: '/', reason: 'expired' })).toBe('/sign-in?reason=expired');
  });
});
