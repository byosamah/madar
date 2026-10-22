import { describe, expect, it } from 'vitest';
import { activeMention, editedBody, excerptOf, linkedProjectCodes, mentionMarkup, mentionedUserIds, mentionsEveryone, normalizeForSearch, plainText, segmentsOf, withMentionMarkup } from './text';

describe('text helpers', () => {
  it('reads mentions once each', () => {
    const body = 'Hi @[Sara Al-Qahtani](usr_005) and @[Omar](usr_004), and again @[Sara Al-Qahtani](usr_005).';
    expect(mentionedUserIds(body)).toEqual(['usr_005', 'usr_004']);
  });

  it('writes mention markup', () => {
    expect(mentionMarkup('Sara', 'usr_005')).toBe('@[Sara](usr_005)');
  });

  it('reads project links', () => {
    expect(linkedProjectCodes('See #KH-26-014 and #KH-26-015.')).toEqual(['KH-26-014', 'KH-26-015']);
  });

  it('ignores case, spaces, diacritics and letter forms in search', () => {
    expect(normalizeForSearch('  CORNICHE   Tower ')).toBe('corniche tower');
    expect(normalizeForSearch('أَحْمَد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إبراهيم')).toBe(normalizeForSearch('ابراهيم'));
    expect(normalizeForSearch('مدرسة')).toBe(normalizeForSearch('مدرسه'));
    expect(normalizeForSearch('مستشفى')).toBe(normalizeForSearch('مستشفي'));
  });
});

describe('mentions in posts', () => {
  const body = 'Hi @[Sara Al-Qahtani](usr_005), see the plan.';

  it('splits a post into text and mentions', () => {
    expect(segmentsOf(body)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' },
      { kind: 'text', text: ', see the plan.' },
    ]);
    expect(plainText(body)).toBe('Hi @Sara Al-Qahtani, see the plan.');
  });

  it('turns picked names into markup, longest name first', () => {
    const people = [{ id: 'usr_010', name: 'Sara' }, { id: 'usr_005', name: 'Sara Al-Qahtani' }];
    expect(withMentionMarkup('@Sara Al-Qahtani and @Sara', people)).toBe('@[Sara Al-Qahtani](usr_005) and @[Sara](usr_010)');
    expect(withMentionMarkup('email@Sara', [])).toBe('email@Sara');
  });

  it('finds the mention at the caret', () => {
    expect(activeMention('Hi @Sa', 6)).toEqual({ start: 3, query: 'Sa' });
    expect(activeMention('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(activeMention('@Sara Al', 8)).toEqual({ start: 0, query: 'Sara Al' });
    expect(activeMention('mail@x', 6)).toBeNull();
    expect(activeMention('Hi @Sa\nnext', 11)).toBeNull();
    expect(activeMention('Hi there', 8)).toBeNull();
  });

  it('finds project links', () => {
    expect(segmentsOf('See #KH-26-014 and @[Sara Al-Qahtani](usr_005)')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'project', code: 'KH-26-014' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' },
    ]);
  });
});

// An edit keeps every mention the text had, also of a person who left the team or changed their name (audit PER-19).
describe('the body of an edited post or comment', () => {
  it('keeps a mention of a person who is no longer in the people list', () => {
    const before = `Please check ${mentionMarkup('Omar Haddad', 'usr_004')} today`;
    const draft = plainText(before).replace('today', 'tomorrow');
    expect(editedBody(draft, [{ id: 'usr_005', name: 'Sara Al-Qahtani' }], before)).toBe(`Please check ${mentionMarkup('Omar Haddad', 'usr_004')} tomorrow`);
  });

  it('links a new mention of a current person too', () => {
    expect(editedBody('Thanks @Sara Al-Qahtani', [{ id: 'usr_005', name: 'Sara Al-Qahtani' }], 'Thanks')).toBe(`Thanks ${mentionMarkup('Sara Al-Qahtani', 'usr_005')}`);
  });
});

// The start of a report message in its notice (owner, 2026-10-07, rule B14).
describe('excerptOf', () => {
  const points = (text: string) => Array.from(text).length;
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('makes each run of white space one space, new lines too, and trims', () => {
    expect(excerptOf('  Fix\n\nthe   board  ')).toBe('Fix the board');
  });

  it('keeps a text of exactly 80 code points', () => {
    const text = `${'word '.repeat(15)}abcde`;
    expect(points(text)).toBe(80);
    expect(excerptOf(text)).toBe(text);
  });

  it('cuts a long text of words at a space and adds the ellipsis', () => {
    const flat = 'The board does not scroll on my phone when I open a project with many tasks in the review column today.';
    const at = flat.indexOf(' ', 20);
    const out = excerptOf(`${flat.slice(0, at)}\n\n  ${flat.slice(at + 1)}`);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(points(out)).toBeLessThanOrEqual(80);
    const head = out.slice(0, -1);
    expect(flat.startsWith(head)).toBe(true);
    expect(flat[head.length]).toBe(' ');
    expect(head.endsWith(' ')).toBe(false);
  });

  it('cuts one long word at 79 code points', () => {
    expect(excerptOf('x'.repeat(120))).toBe(`${'x'.repeat(79)}\u2026`);
  });

  it('cuts at 79 code points when the last space comes before code point 40', () => {
    expect(excerptOf(`ab ${'x'.repeat(100)}`)).toBe(`ab ${'x'.repeat(76)}\u2026`);
  });

  it('never splits an emoji, also in Arabic text', () => {
    const arabic = excerptOf('اللوحة لا تتحرك على هاتفي 📱😀 '.repeat(6));
    expect(points(arabic)).toBeLessThanOrEqual(80);
    expect(loneSurrogate.test(arabic)).toBe(false);
    const emoji = excerptOf('😀'.repeat(100));
    expect(emoji).toBe(`${'😀'.repeat(79)}\u2026`);
    expect(loneSurrogate.test(emoji)).toBe(false);
  });
});

describe('web addresses in a message (design item 7)', () => {
  it('cuts a full stop, a comma and an Arabic comma off the end of an address', () => {
    expect(segmentsOf('The lab quote: https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026.')).toEqual([
      { kind: 'text', text: 'The lab quote: ' }, { kind: 'url', url: 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026' }, { kind: 'text', text: '.' }]);
    expect(segmentsOf('عرض السعر: https://drive.google.com/x، شكرًا')).toEqual([
      { kind: 'text', text: 'عرض السعر: ' }, { kind: 'url', url: 'https://drive.google.com/x' }, { kind: 'text', text: '، شكرًا' }]);
  });
  it('keeps a closing bracket that the address opened, and cuts one that it did not', () => {
    expect(segmentsOf('(see https://en.wikipedia.org/wiki/Mashrabiya_(window))')).toEqual([
      { kind: 'text', text: '(see ' }, { kind: 'url', url: 'https://en.wikipedia.org/wiki/Mashrabiya_(window)' }, { kind: 'text', text: ')' }]);
  });
  it('makes no link of another scheme', () => {
    expect(segmentsOf('ftp://files.test/a javascript:alert(1)')).toEqual([{ kind: 'text', text: 'ftp://files.test/a javascript:alert(1)' }]);
  });
  it('keeps mentions and project codes beside an address', () => {
    expect(segmentsOf('See #KH-26-014 at https://maps.google.com/?q=26.29,50.21 @[Sara Al-Qahtani](usr_005)')).toEqual([
      { kind: 'text', text: 'See ' }, { kind: 'project', code: 'KH-26-014' }, { kind: 'text', text: ' at ' },
      { kind: 'url', url: 'https://maps.google.com/?q=26.29,50.21' }, { kind: 'text', text: ' ' }, { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' }]);
  });
  it('keeps a hash inside an address as a part of it, and makes no link of a bare scheme', () => {
    expect(segmentsOf('https://x.test/plan#KH-26-014')).toEqual([{ kind: 'url', url: 'https://x.test/plan#KH-26-014' }]);
    expect(segmentsOf('Say https://.')).toEqual([{ kind: 'text', text: 'Say https://.' }]);
  });
});

// @everyone (owner, 2026-10-22, fbk_041): the words @everyone, @all and @الجميع name every person of a chat or a to-do thread.
describe('mentionsEveryone', () => {
  it('finds the three words as whole words, in English and in Arabic', () => {
    for (const body of ['@everyone', 'Hello @everyone', '@all please read', 'Team @all, the model is ready', 'مرحبا @الجميع', '@الجميع انتبهوا', 'line one\n@everyone', 'Thanks @everyone.', 'Ready @all!', 'Who? @all?', 'جاهز @الجميع،', '(@all)', '"@everyone"']) {
      expect(mentionsEveryone(body), body).toBe(true);
    }
  });

  it('does not care about the case of the English words', () => {
    for (const body of ['@Everyone', '@EVERYONE hi', 'hi @All', '@ALL']) expect(mentionsEveryone(body), body).toBe(true);
  });

  it('finds no match in an email address, a longer word, or a word glued to text before it', () => {
    for (const body of ['write to x@all.com', 'a@everyone.test', '@allison hi', '@everyones', '@allies', 'mail@all', 'foo@الجميع', '@ all', '@', 'everyone', 'all', 'الجميع', '@الجميعة', '@all.com']) {
      expect(mentionsEveryone(body), body).toBe(false);
    }
  });

  it('finds no match in the mention markup of a person who has such a name', () => {
    expect(mentionsEveryone('@[everyone](usr_005) hello')).toBe(false);
    expect(mentionsEveryone('@[All Hands](usr_005)')).toBe(false);
  });

  it('finds the words next to a mention of a person', () => {
    expect(mentionsEveryone('@[Sara](usr_005) @all see this')).toBe(true);
  });
});

describe('segmentsOf with the everyone words', () => {
  it('makes a segment of the three words only when it is asked to', () => {
    expect(segmentsOf('Hi @all, see')).toEqual([{ kind: 'text', text: 'Hi @all, see' }]);
    expect(segmentsOf('Hi @all, see', { everyone: true })).toEqual([{ kind: 'text', text: 'Hi ' }, { kind: 'everyone', word: '@all' }, { kind: 'text', text: ', see' }]);
    expect(segmentsOf('@الجميع مرحبا', { everyone: true })).toEqual([{ kind: 'everyone', word: '@الجميع' }, { kind: 'text', text: ' مرحبا' }]);
  });

  it('keeps an email address, a longer word and a mention as they were', () => {
    expect(segmentsOf('x@all.com @allies', { everyone: true })).toEqual([{ kind: 'text', text: 'x@all.com @allies' }]);
    expect(segmentsOf('@[Sara](usr_005) @everyone', { everyone: true })).toEqual([
      { kind: 'mention', name: 'Sara', userId: 'usr_005' }, { kind: 'text', text: ' ' }, { kind: 'everyone', word: '@everyone' }]);
  });
});
