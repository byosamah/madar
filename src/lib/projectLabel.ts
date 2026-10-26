import type { TFunction } from 'i18next';
import type { ProjectKind } from '../api/contract/entities';
import type { Lang } from './dates';
import { isInternalCode, projectKey } from './projectCode';

/** A project, or only its code (a task, a file or a message carries just the code). */
export type CodeSource = string | { code: string; kind?: ProjectKind };

/** True for an internal project: its kind says so, or its code has the INT head. */
function internal(source: CodeSource): boolean {
  if (typeof source === 'string') return isInternalCode(source);
  return source.kind === 'internal' || isInternalCode(source.code);
}

/** True when only the team and the chosen people see the project (the lock mark). A missing `access` is an open project. */
export function isHiddenProject(project: { access?: { hidden: boolean } }): boolean {
  return project.access?.hidden === true;
}

/** True for an internal project, by its kind or its INT code. */
export function isInternalProject(source: CodeSource): boolean {
  return internal(source);
}

/**
 * The short key that a row shows where a code shows (fbk_044). An internal project has no code on the screens: the word "Internal" takes
 * its place. The INT code stays in the data and never shows.
 */
export function shownKey(source: CodeSource, t: TFunction): string {
  return internal(source) ? t('project.internal') : projectKey(typeof source === 'string' ? source : source.code);
}

/** The full code that a header or the About panel shows. An internal project shows the word "Internal" instead. */
export function shownCode(source: CodeSource, t: TFunction): string {
  return internal(source) ? t('project.internal') : typeof source === 'string' ? source : source.code;
}

/** A project with its English name and its optional Arabic name (owner, 2026-10-26, fbk_062). */
export type NamedProject = { name: string; nameAr?: string | null };

/**
 * The name of a project in the screen language: Arabic screens show the Arabic name when the project has one, else the English name.
 * English screens always show the English name. Use it at every spot that shows a project name (next to shownKey and shownCode).
 */
export function shownName(project: NamedProject, lang: Lang): string {
  const arabic = project.nameAr?.trim() ?? '';
  return lang === 'ar' && arabic !== '' ? arabic : project.name;
}

/** The name of a project that a screen sorts by: the name it shows. */
export function byShownName(lang: Lang): (a: NamedProject, b: NamedProject) => number {
  return (a, b) => shownName(a, lang).localeCompare(shownName(b, lang), lang);
}
