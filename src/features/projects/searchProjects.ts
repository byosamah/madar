import type { ProjectSummary } from '../../api/contract/views';
import { holdsWords, searchWords } from '../../lib/searchMatch';
import { normalizeForSearch } from '../../lib/text';

/**
 * The search field of the Projects view on a phone (phone design D). It filters the rows that `projects.list` already gave: the name, the
 * code and the client name in both languages, folded like the message search (case, Arabic letters). Every word of the text must be
 * in the row, in any order. No word keeps all rows, and so does a text that every row holds: the same array comes back, so the list does
 * not render again for a letter that changes nothing.
 */
export function searchProjects(rows: ProjectSummary[], query: string): ProjectSummary[] {
  const words = searchWords(query);
  if (words.length === 0) return rows;
  const kept = rows.filter(({ project, client }) => holdsWords(normalizeForSearch([project.name, project.code, client?.name, client?.nameAr].filter(Boolean).join(' ')), words));
  return kept.length === rows.length ? rows : kept;
}
