import { describe, expect, it } from 'vitest';
import { codeInput, codePreview, emptyCodeValues, upperCodeHead, validateCodeValues } from './codeForm';

const parts = { ...emptyCodeValues(), initials: 'AZT', classification: 'RES' as const, buildingType: 'Multi-unit Dev.' };

describe('the project code group of the new-project form (item 6b)', () => {
  it('starts from the parts, with every part empty', () => {
    expect(emptyCodeValues()).toEqual({ codeMode: 'parts', initials: '', classification: '', buildingType: '', typedCode: '', sameAs: '', codeAnyway: false });
  });

  it('asks for the initials, the class and the building type', () => {
    expect(validateCodeValues(emptyCodeValues())).toEqual({
      initials: 'projectCode.errors.initials', classification: 'projectCode.errors.classification', buildingType: 'projectCode.errors.type',
    });
    expect(validateCodeValues(parts)).toEqual({});
    expect(validateCodeValues({ ...parts, initials: 'AZ' }).initials).toBe('projectCode.errors.initials');
    expect(validateCodeValues({ ...parts, buildingType: '   ' }).buildingType).toBe('projectCode.errors.type');
  });

  it('checks a typed code in the old or the new form, and only that field', () => {
    const typed = { ...emptyCodeValues(), codeMode: 'typed' as const };
    expect(validateCodeValues({ ...typed, typedCode: ' 260902azt-res-Villa ' })).toEqual({});
    expect(validateCodeValues({ ...typed, typedCode: 'KH-24-031' })).toEqual({});
    // Outside the office pattern: a warning that the tick "Use this code anyway" lets go (feedback fbk_003). Empty is never right.
    expect(validateCodeValues({ ...typed, typedCode: '260902AZT-XYZ-Villa' })).toEqual({ typedCode: 'projectCode.errors.format' });
    expect(validateCodeValues({ ...typed, typedCode: '260902AZT-XYZ-Villa', codeAnyway: true })).toEqual({});
    expect(validateCodeValues({ ...typed, typedCode: '  ', codeAnyway: true })).toEqual({ typedCode: 'projectCode.errors.full' });
  });

  it('warns when a typed code takes the series of another contract, and sends the tick with the code (feedback fbk_003)', () => {
    const typed = { ...emptyCodeValues(), codeMode: 'typed' as const, typedCode: '260902BAY-COM-Shop' };
    const projects = [{ id: 'prj_001', code: '260902AZT-RES-Villa' }];
    expect(validateCodeValues(typed, projects)).toEqual({ typedCode: 'projectCode.errors.taken' });
    expect(validateCodeValues({ ...typed, codeAnyway: true }, projects)).toEqual({});
    expect(codeInput(typed)).toEqual({ code: '260902BAY-COM-Shop' });
    expect(codeInput({ ...typed, codeAnyway: true })).toEqual({ code: '260902BAY-COM-Shop', codeAnyway: true });
  });

  it('asks for the project of the same contract', () => {
    const same = { ...emptyCodeValues(), codeMode: 'same' as const };
    expect(validateCodeValues(same)).toEqual({ sameAs: 'projectCode.errors.sameAs' });
    expect(validateCodeValues({ ...same, sameAs: 'prj_003' })).toEqual({});
  });

  it('sends one way to give the code to projects.create', () => {
    expect(codeInput(parts)).toEqual({ codeParts: { initials: 'AZT', classification: 'RES', type: 'Multi-unit Dev.' } });
    expect(codeInput({ ...emptyCodeValues(), codeMode: 'typed', typedCode: ' 260902azt-res-Villa ' })).toEqual({ code: '260902AZT-RES-Villa' });
    expect(codeInput({ ...emptyCodeValues(), codeMode: 'same', sameAs: 'prj_003' })).toEqual({ sameContractAs: 'prj_003' });
  });

  it('shows a live preview: this month, the next series and the parts', () => {
    expect(codePreview(parts, { yymm: '2610', series: 4 })).toEqual({ text: '261004AZT-RES-Multi-unit Dev.', complete: true });
  });

  it('shows dots for the parts that are still empty', () => {
    expect(codePreview(emptyCodeValues(), { yymm: '2610', series: 0 })).toEqual({ text: '261000···-···-···', complete: false });
    expect(codePreview({ ...parts, classification: '' }, { yymm: '2610', series: null })).toEqual({ text: '2610··AZT-···-Multi-unit Dev.', complete: false });
  });

  it('shows the code of the project of the same contract, and nothing for a typed code', () => {
    expect(codePreview({ ...emptyCodeValues(), codeMode: 'same', sameAs: 'prj_003' }, { yymm: '2610', series: 0, sameCode: '250311AZT-INS-Mosque' }))
      .toEqual({ text: '250311AZT-INS-Mosque', complete: true });
    expect(codePreview({ ...emptyCodeValues(), codeMode: 'same' }, { yymm: '2610', series: 0, sameCode: null })).toBeNull();
    expect(codePreview({ ...emptyCodeValues(), codeMode: 'typed', typedCode: 'KH-24-031' }, { yymm: '2610', series: 0 })).toBeNull();
  });

  it('makes the key and the class capitals while the person types, and keeps every space', () => {
    expect(upperCodeHead('260902azt-res-Multi-unit ')).toBe('260902AZT-RES-Multi-unit ');
    expect(upperCodeHead('260902azt')).toBe('260902AZT');
    expect(upperCodeHead('kh-26-014')).toBe('KH-26-014');
  });
});
