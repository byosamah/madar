import { describe, expect, it } from 'vitest';
import { hideSpans, MAX_SCAN, redactText, scrubText, scrubUrl } from './urlScrub';

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

describe('the work stays small for a huge text (insight design, fourth security fix)', () => {
  const huge = 'a'.repeat(200_000);
  const marks = '/a('.repeat(70_000);

  it('runs scrubText and redactText on a 200,000 character text in under 50 ms', () => {
    for (const text of [huge, marks, '"'.repeat(200_000), '.'.repeat(200_000), `https://${'a'.repeat(200_000)}`]) {
      const started = performance.now();
      scrubText(text);
      redactText(text);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });

  it('reads at most MAX_SCAN characters', () => {
    expect(scrubText('b'.repeat(10_000))).toHaveLength(MAX_SCAN);
    expect(redactText('x '.repeat(10_000)).length).toBeLessThanOrEqual(MAX_SCAN);
  });

  it('still finds the emails in a short text', () => {
    expect(redactText('no user a.b@vado.sa')).toBe('no user <email>');
    expect(redactText('mail abcdefghijklmnopqrstuvwxyz@vado.sa failed')).toBe('mail <email> failed');
    expect(redactText('a lone @ and trailing x@ stay')).toBe('a lone @ and trailing x@ stay');
  });
});

describe('hideSpans, the one scanner for quotes and =( values (insight design, sixth security fix)', () => {
  const pad = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n);

  it('hides a double quoted part, a single quoted part and a paren value, and keeps the words around', () => {
    expect(hideSpans('violates "users_email_key" now')).toBe('violates "..." now');
    expect(hideSpans("value 'Secret villa' is long")).toBe('value "..." is long');
    expect(hideSpans('Key (name)=(Secret villa) exists')).toBe('Key (name)=(...) exists');
  });

  it('hides every character between an opener and its closer, with mixed nesting', () => {
    expect(hideSpans(`a 'x "y' z"`)).toBe('a "..." z"..."');
    expect(hideSpans(`a "x 'y" z'`)).toBe(`a "..." z'`);
    expect(hideSpans('a "x (y=(z" b')).toBe('a "..." b');
    expect(hideSpans(`a =(x "y) z`)).toBe('a =(...) z');
    for (const out of [hideSpans(`a 'x "y' z"`), hideSpans(`a "x 'y" z'`)]) expect(out).not.toMatch(/[xy]/);
  });

  it('hides the rest of the text after an open quote, an open apostrophe-quote or an open =(', () => {
    expect(hideSpans('start "secret goes on')).toBe('start "..."');
    expect(hideSpans("start 'secret goes on")).toBe('start "..."');
    expect(hideSpans('start =(a@b.c and more')).toBe('start =(...)');
    expect(redactText(`${pad(MAX_SCAN - 20)}"${'secret '.repeat(10)}`).endsWith('"..."')).toBe(true);
    expect(redactText(`${pad(MAX_SCAN - 20)}"${'secret '.repeat(10)}`)).not.toContain('secret');
    expect(redactText(`${pad(MAX_SCAN - 12)}=(a.b@vado.sa and more words`).endsWith('=(...)')).toBe(true);
    expect(redactText(`${pad(MAX_SCAN - 15)} 'secret words here and more`)).not.toContain('secret');
  });

  it('keeps an apostrophe inside a word', () => {
    expect(hideSpans("don't stop, it's fine")).toBe("don't stop, it's fine");
    expect(hideSpans("'tis")).toBe('"..."');
  });

  it('keeps a plain text as it is, and cuts a long plain text to MAX_SCAN', () => {
    expect(hideSpans('A call failed.')).toBe('A call failed.');
    expect(hideSpans('')).toBe('');
    expect(redactText(pad(10_000))).toBe(pad(10_000).slice(0, MAX_SCAN));
  });

  it('runs a huge text with many open marks in under 50 ms', () => {
    const started = performance.now();
    hideSpans('=("\''.repeat(100_000));
    redactText('=("\''.repeat(100_000));
    redactText('a'.repeat(200_000));
    expect(performance.now() - started).toBeLessThan(50);
  });
});
