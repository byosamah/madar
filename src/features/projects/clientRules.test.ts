import { describe, expect, it } from 'vitest';
import type { Client } from '../../api/contract/entities';
import { clientInput, clientPatch, draftOfClient, emptyClientDraft, otherWithInitials, validateClientDraft } from './clientRules';

const gulf: Client = { id: 'cli_001', name: 'Gulf Crest Holding', nameAr: 'قمة الخليج', contactName: 'Nawaf', phone: '+966', email: 'n@gulf.test', initials: 'GCH' };
const dune: Client = { id: 'cli_002', name: 'Dune Line', contactName: '', phone: '', email: '' };

describe('the client form rules (item 1)', () => {
  it('asks for a name in English or in Arabic, initials and nothing else', () => {
    expect(validateClientDraft(emptyClientDraft())).toEqual({ name: 'clientForm.errors.name', initials: 'clientForm.errors.initials' });
  });

  it('takes an Arabic name alone, or an English name alone', () => {
    expect(validateClientDraft({ ...emptyClientDraft(), nameAr: 'مالك الفيلا', initials: 'MVO' })).toEqual({});
    expect(validateClientDraft({ ...emptyClientDraft(), name: 'Villa Owner', initials: 'VLO' })).toEqual({});
  });

  it('takes 3 or 4 capital letters as initials, and refuses the rest', () => {
    const base = { ...emptyClientDraft(), name: 'Villa Owner' };
    expect(validateClientDraft({ ...base, initials: 'VLOW' })).toEqual({});
    for (const initials of ['VL', 'VLOWN', 'V1O', 'أبج']) expect(validateClientDraft({ ...base, initials }).initials).toBe('clientForm.errors.initials');
  });

  it('checks the email only when there is one', () => {
    const base = { ...emptyClientDraft(), name: 'Villa Owner', initials: 'VLO' };
    expect(validateClientDraft({ ...base, email: 'owner@villa.test' })).toEqual({});
    expect(validateClientDraft({ ...base, email: 'owner at villa' }).email).toBe('clientForm.errors.email');
  });

  it('lets an old client without initials keep none when the form edits it', () => {
    const draft = draftOfClient(dune);
    expect(validateClientDraft(draft, { initialsOptional: true })).toEqual({});
    expect(validateClientDraft({ ...draft, initials: 'du' }, { initialsOptional: true }).initials).toBe('clientForm.errors.initials');
  });

  it('makes the create input with trimmed names, and the contact as the client when "Same as the client" is on', () => {
    const draft = { ...emptyClientDraft(), name: ' Villa Owner ', nameAr: ' مالك ', initials: 'VLO', contactName: 'X', same: true, phone: ' 050 ', email: ' ' };
    expect(clientInput(draft, 'en')).toEqual({ name: 'Villa Owner', nameAr: 'مالك', initials: 'VLO', contactName: 'Villa Owner', phone: '050', email: '' });
    expect(clientInput(draft, 'ar').contactName).toBe('مالك');
  });

  it('leaves the initials out of the input when the field is empty', () => {
    expect(clientInput({ ...draftOfClient(dune) }, 'en')).not.toHaveProperty('initials');
  });

  it('makes a patch of the changed fields only', () => {
    const draft = { ...draftOfClient(gulf), phone: '+966 13', initials: 'GCHL' };
    expect(clientPatch(gulf, draft, 'en')).toEqual({ phone: '+966 13', initials: 'GCHL' });
    expect(clientPatch(gulf, draftOfClient(gulf), 'en')).toEqual({});
  });

  it('names another client with the same initials, as a warning', () => {
    expect(otherWithInitials('GCH', [gulf, dune], null)?.id).toBe('cli_001');
    expect(otherWithInitials('GCH', [gulf, dune], 'cli_001')).toBeUndefined();
    expect(otherWithInitials('', [gulf, dune], null)).toBeUndefined();
  });
});
