import type { Action } from '../api/permissions';

/**
 * The What's new entries, newest first (fbk_018). Each id has its title and its body in the word files
 * (`whatsNew.items.<id>.title` and `whatsNew.items.<id>.body`, src/i18n/real/whatsnew.<lang>.json).
 * Add a new entry at the top. The id is the release day and the number of the entry on that day.
 *
 * `right` (UX audit 2026-10-19, chats-14): the page shows the entry only to a person who holds this right, so a Member does not read
 * what only the Admin can do. `to`: the address of the screen that the entry names. The page ends the entry with one quiet link
 * "Open", so the person does not search for the feature.
 */
export type WhatsNewEntry = { id: string; day: string; right?: Action; to?: string };

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  { id: '2026-10-23-26', day: '2026-10-23', to: '/inbox' },
  { id: '2026-10-23-23', day: '2026-10-23', to: '/projects' },
  { id: '2026-10-23-22', day: '2026-10-23', to: '/meetings' },
  { id: '2026-10-23-21', day: '2026-10-23', to: '/projects' },
  { id: '2026-10-23-20', day: '2026-10-23' },
  { id: '2026-10-23-19', day: '2026-10-23' },
  { id: '2026-10-23-18', day: '2026-10-23', to: '/dashboard?view=people' },
  { id: '2026-10-23-17', day: '2026-10-23', to: '/inbox' },
  { id: '2026-10-23-16', day: '2026-10-23' },
  { id: '2026-10-23-15', day: '2026-10-23' },
  { id: '2026-10-23-14', day: '2026-10-23', to: '/projects' },
  { id: '2026-10-23-13', day: '2026-10-23' },
  { id: '2026-10-23-1', day: '2026-10-23', to: '/projects' },
  { id: '2026-10-23-2', day: '2026-10-23', to: '/settings' },
  { id: '2026-10-23-3', day: '2026-10-23' },
  { id: '2026-10-23-4', day: '2026-10-23', to: '/inbox' },
  { id: '2026-10-23-5', day: '2026-10-23', to: '/inbox' },
  { id: '2026-10-23-6', day: '2026-10-23' },
  { id: '2026-10-23-7', day: '2026-10-23', right: 'admin.manage', to: '/admin/sub-companies' },
  { id: '2026-10-23-8', day: '2026-10-23', to: '/dashboard?view=map' },
  { id: '2026-10-23-9', day: '2026-10-23', to: '/dashboard/space' },
  { id: '2026-10-23-10', day: '2026-10-23', right: 'templates.manageAll', to: '/admin/project-templates' },
  { id: '2026-10-23-11', day: '2026-10-23', right: 'admin.manage', to: '/admin/roles' },
  { id: '2026-10-23-12', day: '2026-10-23', right: 'report.office' },
];
