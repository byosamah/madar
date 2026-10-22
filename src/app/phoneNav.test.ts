import { describe, expect, it } from 'vitest';
import ar from '../i18n/real/phoneshell.ar.json';
import en from '../i18n/real/phoneshell.en.json';
import { PHONE_NAV, phoneTabOf } from './nav';

describe('the phone tabs', () => {
  it('lists the four phone tabs in order', () => {
    expect(PHONE_NAV.map((i) => [i.tab, i.to, i.key])).toEqual([
      ['today', '/', 'phoneShell.tab.today'],
      ['inbox', '/inbox', 'phoneShell.tab.inbox'],
      ['work', '/work', 'phoneShell.tab.work'],
      ['me', '/me', 'phoneShell.tab.me'],
    ]);
  });

  it.each([
    ['/', 'today'],
    ['/inbox', 'inbox'], ['/inbox/cnv_1', 'inbox'], ['/notifications', 'inbox'],
    ['/work', 'work'], ['/meetings', 'work'], ['/projects', 'work'], ['/projects/prj_001', 'work'], ['/projects/code/ABC', 'work'],
    ['/me', 'me'], ['/me/profile', 'me'], ['/settings', 'me'], ['/whats-new', 'me'], ['/dashboard', 'me'], ['/tasks', 'me'], ['/admin', 'me'], ['/admin/people', 'me'],
    ['/search', null], ['/nope', null], ['/dashboard/meeting', null], ['/projectsx', null], ['/inboxes', null],
  ])('phoneTabOf(%s) is %s', (path, tab) => expect(phoneTabOf(path)).toBe(tab));

  it('says each tab word in English and in Arabic', () => {
    expect(en.phoneShell.tab).toEqual({ today: 'Today', inbox: 'Inbox', work: 'Work', me: 'Me' });
    expect(ar.phoneShell.tab).toEqual({ today: 'اليوم', inbox: 'الوارد', work: 'العمل', me: 'أنا' });
  });
});
