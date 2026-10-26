import { useCallback, useMemo } from 'react';
import { byShownName, shownName, type NamedProject } from '../lib/projectLabel';
import { useLang } from './lang';

/**
 * The name of a project in the screen language (owner, 2026-10-26, fbk_062): the Arabic name on Arabic screens when the project has
 * one, else the English name. English screens never change. Use: `const projectName = useProjectName();` then `projectName(project)`.
 */
export function useProjectName(): (project: NamedProject) => string {
  const lang = useLang();
  return useCallback((project: NamedProject) => shownName(project, lang), [lang]);
}

/** Sorts projects by the name that the screen shows: `[...rows].sort((a, b) => byName(a.project, b.project))`. */
export function useByProjectName(): (a: NamedProject, b: NamedProject) => number {
  const lang = useLang();
  return useMemo(() => byShownName(lang), [lang]);
}
