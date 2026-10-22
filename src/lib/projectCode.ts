/**
 * The project code (owner, 2026-10-05): `YYMMSSINI-CLS-Type`, for example `260902AZT-RES-Multi-unit Dev.`.
 * YYMM is the month the office registered the project, SS the series of that month (firm wide, from 00), INI the client
 * initials (3 or 4 capital letters), CLS the class, and Type the building type (1 to 40 characters).
 * The key `YYMMSSINI` names the project in tight places and in links. YYMMSS names the contract: two projects of one
 * contract share one code. Codes of the old form (`KH-26-014`) stay as they are.
 */

export const CLASSIFICATIONS = ['RES', 'COM', 'IND', 'INS', 'REC', 'AGR', 'UTL', 'MIX'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** The most characters of the building type. */
export const TYPE_MAX = 40;
/** 3 or 4 capital Latin letters. */
export const INITIALS_PATTERN = /^[A-Z]{3,4}$/;
/** The key of a new code, as a pattern source with no groups, for links in posts. */
export const KEY_PATTERN = '\\d{2}(?:0[1-9]|1[0-2])\\d{2}[A-Z]{3,4}';
/** The old form, before 2026-10-05. */
export const OLD_CODE_PATTERN = '[A-Z]{1,4}-\\d{2}-\\d{3,}';

const CLASS_GROUP = CLASSIFICATIONS.join('|');
/** The type: no space at its start or end, no new line, 1 to 40 characters. */
const TYPE_GROUP = `\\S(?:.{0,${TYPE_MAX - 2}}\\S)?`;
const NEW_CODE = new RegExp(`^(\\d{2})(0[1-9]|1[0-2])(\\d{2})([A-Z]{3,4})-(${CLASS_GROUP})-(${TYPE_GROUP})$`);
const OLD_CODE = new RegExp(`^${OLD_CODE_PATTERN}$`);

/** One pattern for both forms, so the contract and the JSON schema of the agents can name it. */
export const PROJECT_CODE_PATTERN = new RegExp(
  `^(?:${OLD_CODE_PATTERN}|\\d{2}(?:0[1-9]|1[0-2])\\d{2}[A-Z]{3,4}-(?:${CLASS_GROUP})-${TYPE_GROUP})$`,
);

/**
 * A code that a person keeps after the warning (feedback fbk_003, 2026-10-12): any code on one line, with no space at its start or
 * end, of 1 to 60 characters. Every code of the office pattern is one too. The record takes any of them; a typed code outside the
 * pattern needs codeAnyway (projects.create, projects.update).
 * Only visible characters and the plain space (U+0020), so a code always shows as it is saved: the pattern refuses control
 * characters, line breaks, every other space (two codes would look the same), direction marks and isolates, zero-width and
 * other invisible marks, variation selectors, and every character outside the basic plane (their surrogate halves: invisible
 * tag characters and emoji). The escapes stay escapes (src/CLAUDE.md). The server reads the pattern with no "u" flag, one UTF-16
 * unit at a time, as the 60-character limit of the field counts them.
 */
export const FREE_CODE_MAX = 60;
const HIDDEN = [
  '\\u0000-\\u001F', '\\u007F-\\u00A0', '\\u00AD', '\\u034F', '\\u061C', '\\u115F\\u1160', '\\u1680', '\\u17B4\\u17B5', '\\u180B-\\u180F',
  '\\u2000-\\u200F', '\\u2028-\\u202F', '\\u205F-\\u206F', '\\u3000', '\\u3164', '\\uD800-\\uDFFF', '\\uE000-\\uF8FF', '\\uFE00-\\uFE0F',
  '\\uFEFF', '\\uFFA0', '\\uFFF0-\\uFFFF',
].join('');
/** Visible text of 1 to "max" characters: no hidden character, and no space at its start or end. */
const visibleText = (max: number) => `[^ ${HIDDEN}](?:[^${HIDDEN}]{0,${max - 2}}[^ ${HIDDEN}])?`;
export const FREE_CODE_PATTERN = new RegExp(`^${visibleText(FREE_CODE_MAX)}$`);
/** The building type of a new code from its parts: visible text of 1 to 40 characters. */
export const TYPE_PATTERN = new RegExp(`^${visibleText(TYPE_MAX)}$`);
/** The pattern of any free text on one line of visible characters, 1 to "max" long (the title of a meeting). */
export function visibleTextPattern(max: number): RegExp {
  return new RegExp(`^${visibleText(max)}$`);
}

/**
 * Every code that a record may hold: a code of the office pattern (also one saved before 2026-10-12, whose type may hold a
 * character that a new code may not), or a kept code of visible text. A new or changed code passes FREE_CODE_PATTERN.
 */
export const RECORD_CODE_PATTERN = new RegExp(`${PROJECT_CODE_PATTERN.source}|${FREE_CODE_PATTERN.source}`);

/** True for any code that a person may keep after the warning. */
export function isFreeCode(code: string): boolean {
  return FREE_CODE_PATTERN.test(code);
}

export type CodeParts = { yymm: string; series: string; initials: string; classification: Classification; type: string };

/** The parts of a code of the new form, or null for an old code or a wrong one. */
export function parseProjectCode(code: string): CodeParts | null {
  const match = NEW_CODE.exec(code);
  if (!match) return null;
  const [, yy, mm, series, initials, classification, type] = match;
  return { yymm: `${yy}${mm}`, series, initials, classification: classification as Classification, type };
}

/** True for a code of the old or the new form. */
export function isProjectCode(code: string): boolean {
  return OLD_CODE.test(code) || NEW_CODE.test(code);
}

export function buildProjectCode(parts: { yymm: string; series: number | string; initials: string; classification: Classification; type: string }): string {
  const series = typeof parts.series === 'number' ? String(parts.series).padStart(2, '0') : parts.series;
  return `${parts.yymm}${series}${parts.initials}-${parts.classification}-${parts.type.trim()}`;
}

/** The head of the code of an internal project (fbk_044). The screens never show this code; they show the word "Internal". */
export const INTERNAL_PREFIX = 'INT';
const INTERNAL_CODE = new RegExp(`^${INTERNAL_PREFIX}-\\d{2}-\\d{3,}$`);

/** True for the automatic code of an internal project, like INT-26-001. A row that carries a code and no kind uses this. */
export function isInternalCode(code: string): boolean {
  return INTERNAL_CODE.test(code);
}

/** The key YYMMSSINI of a new code. An old code is its own key. */
export function projectKey(code: string): string {
  const parts = parseProjectCode(code);
  return parts ? `${parts.yymm}${parts.series}${parts.initials}` : code;
}

/** YYMMSS, the contract of a new code. An old code has none. */
export function contractOf(code: string): string | null {
  const parts = parseProjectCode(code);
  return parts ? `${parts.yymm}${parts.series}` : null;
}

/** YYMM of an office day (YYYY-MM-DD). */
export function codeMonth(day: string): string {
  return `${day.slice(2, 4)}${day.slice(5, 7)}`;
}

/** The highest series of that month plus 1, from 0. Null when the month used series 99. */
export function nextSeries(codes: Iterable<string>, yymm: string): number | null {
  let highest = -1;
  for (const code of codes) {
    const parts = parseProjectCode(code);
    if (parts && parts.yymm === yymm) highest = Math.max(highest, Number(parts.series));
  }
  return highest >= 99 ? null : highest + 1;
}

/** True when "ref" is the full code or the key of "code". */
export function codeMatches(code: string, ref: string): boolean {
  return code === ref || projectKey(code) === ref;
}

/** Typed initials become capitals. The rule message explains any other character. */
export function normalizeInitials(text: string): string {
  return text.toUpperCase();
}

/** A code typed by hand: the key and the class become capitals. The type stays as the person typed it. */
export function normalizeTypedCode(text: string): string {
  const parts = text.trim().split('-');
  if (parts.length < 3) return text.trim().toUpperCase();
  return [parts[0].toUpperCase(), parts[1].toUpperCase(), parts.slice(2).join('-')].join('-');
}

/**
 * Why a typed code needs the tick "Use this code anyway" (feedback fbk_003, 2026-10-12): 'format' when it does not match the office
 * pattern, 'taken' when its YYMMSS belongs to another contract. Null: no warning. Two projects of one contract share the whole
 * code, so the same code is no warning, and "selfId" is the project itself in a correction.
 */
export function codeWarning(code: string, projects: Iterable<{ id: string; code: string }>, selfId: string | null): 'format' | 'taken' | null {
  if (!isProjectCode(code)) return 'format';
  return contractClash(code, projects, selfId) ? 'taken' : null;
}

/** The other project whose code has the YYMMSS of this code with other initials, class or type. An old code has no YYMMSS. */
export function contractClash<P extends { id: string; code: string }>(code: string, projects: Iterable<P>, selfId: string | null): P | null {
  const contract = contractOf(code);
  if (!contract) return null;
  for (const project of projects) {
    if (project.id !== selfId && project.code !== code && contractOf(project.code) === contract) return project;
  }
  return null;
}
