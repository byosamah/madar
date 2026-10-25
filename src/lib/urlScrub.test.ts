import { describe, expect, it } from 'vitest';
import { redactText, scrubText, scrubUrl } from './urlScrub';

describe('scrubUrl', () => {
  it('keeps the origin, the path and the tab of a project page', () => {
    expect(scrubUrl('https://madar.vado.sa/projects/prj_1?tab=files&task=tsk_9#x')).toBe('https://madar.vado.sa/projects/prj_1?tab=files');
  });

  it('drops the whole fragment, so no Google code or state goes out', () => {
    expect(scrubUrl('https://madar.vado.sa/settings#google=finish&code=abc&state=def')).toBe('https://madar.vado.sa/settings');
  });

  it('drops a search text', () => {
    expect(scrubUrl('https://madar.vado.sa/search?q=client%20name')).toBe('https://madar.vado.sa/search');
  });

  it('drops the signature of a file link', () => {
    expect(scrubUrl('https://a.eu.r2.cloudflarestorage.com/madar-files/k?X-Amz-Signature=1')).toBe('https://a.eu.r2.cloudflarestorage.com/madar-files/k');
  });

  it('gives a text that is no address back as it is', () => {
    expect(scrubUrl('not a url')).toBe('not a url');
    expect(scrubUrl('')).toBe('');
  });

  it('never returns a value with a query or a hash as it is (fail closed)', () => {
    expect(scrubUrl('?q=secret')).toBe('');
    expect(scrubUrl('#code=1')).toBe('');
    expect(scrubUrl('search?q=x')).toBe('search');
    expect(scrubUrl('search?tab=files&q=x#h')).toBe('search?tab=files');
    expect(scrubUrl('page#code=1?x')).toBe('page');
  });

  it('scrubs a path with a query and no host', () => {
    expect(scrubUrl('/settings?x=1#google=finish&code=abc')).toBe('/settings');
    expect(scrubUrl('/projects/prj_1?tab=tasks&task=t1')).toBe('/projects/prj_1?tab=tasks');
  });
});

describe('scrubText', () => {
  it('scrubs each address inside a message', () => {
    expect(scrubText('Failed https://x.test/a?sig=1 now')).toBe('Failed https://x.test/a now');
  });

  it('keeps the mark after an address', () => {
    expect(scrubText('Load failed (https://x.test/a?sig=1).')).toBe('Load failed (https://x.test/a).');
    expect(scrubText('Go to https://x.test/a?sig=1, then stop')).toBe('Go to https://x.test/a, then stop');
  });

  it('scrubs two addresses', () => {
    expect(scrubText('a https://x.test/a?s=1 b http://y.test/b#h c')).toBe('a https://x.test/a b http://y.test/b c');
  });

  it('scrubs an address with capital letters', () => {
    expect(scrubText('Failed HTTPS://X.test/a?sig=1 now')).toBe('Failed https://x.test/a now');
  });

  it('scrubs a path with a query or a hash inside a text', () => {
    expect(scrubText('Open /settings#google=finish&code=abc now')).toBe('Open /settings now');
    expect(scrubText('Open /projects/prj_1?task=t1, then')).toBe('Open /projects/prj_1, then');
    expect(scrubText('/search?q=secret')).toBe('/search');
    expect(scrubText('Open /projects/prj_1 now')).toBe('Open /projects/prj_1 now');
  });

  it('keeps a text with no address', () => {
    expect(scrubText('Something broke')).toBe('Something broke');
  });
});

describe('redactText (the server record, insight design)', () => {
  it('keeps the words of a database error and shows its quoted part as "..."', () => {
    expect(redactText('duplicate key value violates unique constraint "users_email_key"')).toBe('duplicate key value violates unique constraint "..."');
    expect(redactText("value 'Secret villa' is too long")).toBe('value "..." is too long');
  });

  it('keeps an apostrophe inside a word', () => {
    expect(redactText("can't read, it's gone")).toBe("can't read, it's gone");
  });

  it('replaces an email address with <email>', () => {
    expect(redactText('no user a.b@vado.sa')).toBe('no user <email>');
  });

  it('replaces a run of 20 or more letters, digits, underscores or dashes with <token>', () => {
    expect(redactText('bad token eyJhbGciOiJIUzI1NiIsInR5cCI6')).toBe('bad token <token>');
    expect(redactText('short abc_def-123 stays')).toBe('short abc_def-123 stays');
  });

  it('keeps a plain text as it is', () => {
    expect(redactText('A call failed.')).toBe('A call failed.');
    expect(redactText('')).toBe('');
  });

  it('cuts the email before the token, so the address never shows as a token', () => {
    expect(redactText('mail abcdefghijklmnopqrstuvwxyz@vado.sa failed')).toBe('mail <email> failed');
  });
});
