import { markOf } from './projectMark';

type Named = { id: string; code: string; name: string; nameAr?: string; mark?: number; shape?: string | null };

/** The own shape of the picture goes in only when the project has one (owner, 2026-10-26), so an answer keeps its old form without it. */
const shapeOf = (project: { shape?: string | null }) => (project.shape ? { shape: project.shape } : {});

/**
 * A project as another view names it: its code, both names and its picture mark. The Arabic name goes in only when the project has one
 * (owner, 2026-10-26, fbk_062), so an answer for a project with no Arabic name keeps its old shape. The picture shape follows the same rule.
 */
export function projectRef(project: Named) {
  return { id: project.id, code: project.code, name: project.name, ...(project.nameAr ? { nameAr: project.nameAr } : {}), mark: markOf(project), ...shapeOf(project) };
}

/** The small form of a project for a notice tile: no code. */
export function projectTile(project: Omit<Named, 'code'>) {
  return { id: project.id, name: project.name, ...(project.nameAr ? { nameAr: project.nameAr } : {}), mark: markOf(project), ...shapeOf(project) };
}
