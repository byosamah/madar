import { describe, expect, it } from 'vitest';
import { screenKey, tabIndexOf } from './phoneShell';

describe('screenKey', () => {
  it.each([
    ['/inbox/cnv_1', false, '/inbox'], ['/admin/people', false, '/admin'], ['/meetings', false, '/work'], ['/projects', false, '/projects'], ['/notifications', false, '/notifications'],
    ['/projects', true, '/work'], ['/meetings', true, '/work'], ['/work', true, '/work'], ['/notifications', true, '/inbox'], ['/inbox/cnv_1', true, '/inbox'],
    ['/me/profile', true, '/me/profile'], ['/projects/prj_001', true, '/projects/prj_001'],
  ])('screenKey(%s, phone %s) is %s', (path, phone, key) => expect(screenKey(path, phone)).toBe(key));
});

describe('tabIndexOf', () => {
  it.each([
    ['/', true, 0], ['/inbox', true, 1], ['/notifications', true, 1], ['/work', true, 2], ['/projects', true, 2], ['/meetings', true, 2],
    ['/me', true, 3], ['/admin/people', true, 3], ['/projects/prj_001', true, -1], ['/search', true, -1],
    ['/', false, 0], ['/projects', false, 1], ['/work', false, 2], ['/dashboard', false, 3], ['/inbox', false, 4], ['/projects/prj_001', false, -1],
  ])('tabIndexOf(%s, phone %s) is %i', (path, phone, index) => expect(tabIndexOf(path, phone)).toBe(index));
});
