import { describe, expect, it } from 'vitest';
import { phoneMainButton, tabButtonShows, type MainCan } from './mainButton';

const can = (o: Partial<MainCan>): MainCan => ({ postUpdate: false, logTracker: false, upload: false, links: false, ...o });

describe('the one navy button of each project tab on a phone (phone D, P5)', () => {
  it.each([
    ['tracker', can({ logTracker: true }), false, 'log'],
    ['tracker', can({}), false, 'post'],
    ['files', can({ upload: true }), false, 'add'],
    ['files', can({ links: true }), false, 'add'],
    ['files', can({}), false, 'post'],
    ['overview', can({ postUpdate: true }), true, 'box'],
    ['overview', can({ postUpdate: false }), true, 'post'],
    ['overview', can({ postUpdate: true }), false, 'post'],
    ['tasks', can({ postUpdate: true }), true, 'post'],
    ['more', can({ postUpdate: true, logTracker: true }), true, 'post'],
  ] as const)('%s with %j and a draft %s gives %s', (tab, rights, draft, wanted) => {
    expect(phoneMainButton(tab, rights, draft)).toBe(wanted);
  });

  it('knows when a tab button shows', () => {
    expect(tabButtonShows('tracker', can({ logTracker: true }))).toBe(true);
    expect(tabButtonShows('tracker', can({ upload: true }))).toBe(false);
    expect(tabButtonShows('files', can({ upload: true }))).toBe(true);
    expect(tabButtonShows('files', can({ links: true }))).toBe(true);
    expect(tabButtonShows('files', can({ logTracker: true }))).toBe(false);
  });
});
