import { describe, expect, it } from 'vitest';
import { keepDraftsOf, readDraft, writeDraft } from './drafts';

describe('drafts (design item 7)', () => {
  it('keeps a draft in the local store, so it stays after the tab closes', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'Half a thought');
    expect(window.localStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBe('Half a thought');
    expect(window.sessionStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBeNull();
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('Half a thought');
  });
  it('moves a draft of the old session store on its first read', () => {
    window.sessionStorage.setItem('madar.draft.usr_001.chat:cnv_001', 'From before');
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('From before');
    expect(window.localStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBe('From before');
    expect(window.sessionStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBeNull();
  });
  it('drops every draft in both stores at sign-out', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'One');
    window.sessionStorage.setItem('madar.draft.usr_002.task:tsk_001', 'Two');
    keepDraftsOf('');
    const left = [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)].filter((key) => key.startsWith('madar.draft.'));
    expect(left).toEqual([]);
  });
  it('keeps only the drafts of the current person', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'Mine');
    writeDraft('usr_002', 'chat:cnv_001', 'Not mine');
    keepDraftsOf('usr_001');
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('Mine');
    expect(window.localStorage.getItem('madar.draft.usr_002.chat:cnv_001')).toBeNull();
  });
  it('clears a draft when its text is empty', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'Half a thought');
    writeDraft('usr_001', 'chat:cnv_001', '');
    expect(window.localStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBeNull();
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('');
  });
});
