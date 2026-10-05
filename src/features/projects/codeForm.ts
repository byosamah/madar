import {
  buildProjectCode, INITIALS_PATTERN, isProjectCode, normalizeTypedCode, TYPE_MAX, type Classification,
} from '../../lib/projectCode';

/**
 * The "Project code" group of the new-project form (owner, 2026-10-05, item 6b). The default makes the code from its parts.
 * "Type the code by hand" takes a full code. "Same contract as another project" copies the code of that project.
 */
export type CodeMode = 'parts' | 'typed' | 'same';

export type CodeValues = {
  codeMode: CodeMode;
  initials: string;
  classification: Classification | '';
  buildingType: string;
  typedCode: string;
  sameAs: string;
};

/** Each value is a text key, so the form shows the message in the screen language. */
export type CodeErrors = Partial<Record<'initials' | 'classification' | 'buildingType' | 'typedCode' | 'sameAs', string>>;
export const CODE_FIELDS = ['initials', 'classification', 'buildingType', 'typedCode', 'sameAs'] as const;

export function emptyCodeValues(): CodeValues {
  return { codeMode: 'parts', initials: '', classification: '', buildingType: '', typedCode: '', sameAs: '' };
}

/** The same rules as projects.create. Only the fields of the open way count. */
export function validateCodeValues(values: CodeValues): CodeErrors {
  if (values.codeMode === 'typed') return isProjectCode(normalizeTypedCode(values.typedCode)) ? {} : { typedCode: 'projectCode.errors.full' };
  if (values.codeMode === 'same') return values.sameAs ? {} : { sameAs: 'projectCode.errors.sameAs' };
  const errors: CodeErrors = {};
  if (!INITIALS_PATTERN.test(values.initials.trim())) errors.initials = 'projectCode.errors.initials';
  if (!values.classification) errors.classification = 'projectCode.errors.classification';
  const type = values.buildingType.trim();
  if (!type || type.length > TYPE_MAX || /[\n\r]/.test(type)) errors.buildingType = 'projectCode.errors.type';
  return errors;
}

/** The part of the projects.create input that gives the code. Call it only when validateCodeValues found nothing. */
export function codeInput(values: CodeValues) {
  if (values.codeMode === 'typed') return { code: normalizeTypedCode(values.typedCode) };
  if (values.codeMode === 'same') return { sameContractAs: values.sameAs };
  return {
    codeParts: { initials: values.initials.trim(), classification: values.classification as Classification, type: values.buildingType.trim() },
  };
}

const EMPTY_PART = '···';

/**
 * The live preview of the new code: YYMM of this month, the next free series, and the parts. A part that is still empty
 * shows as dots. A typed code has no preview: its own field shows it.
 */
export function codePreview(
  values: CodeValues, at: { yymm: string; series: number | null; sameCode?: string | null },
): { text: string; complete: boolean } | null {
  if (values.codeMode === 'typed') return null;
  if (values.codeMode === 'same') return at.sameCode ? { text: at.sameCode, complete: true } : null;
  const initials = values.initials.trim();
  const type = values.buildingType.trim();
  const complete = Object.keys(validateCodeValues(values)).length === 0 && at.series !== null;
  if (complete) {
    return { text: buildProjectCode({ yymm: at.yymm, series: at.series!, initials, classification: values.classification as Classification, type }), complete };
  }
  const series = at.series === null ? '··' : String(at.series).padStart(2, '0');
  return { text: `${at.yymm}${series}${initials || EMPTY_PART}-${values.classification || EMPTY_PART}-${type || EMPTY_PART}`, complete };
}

/** While a person types a code: the key and the class become capitals. Spaces stay, so the type can hold two words. */
export function upperCodeHead(text: string): string {
  const parts = text.split('-');
  return parts.map((part, i) => (i < 2 ? part.toUpperCase() : part)).join('-');
}
