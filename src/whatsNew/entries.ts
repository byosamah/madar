import type { Action } from '../api/permissions';

/**
 * The What's new entries, newest first (fbk_018). Each id has its title and its body in the word files
 * (`whatsNew.items.<id>.title` and `whatsNew.items.<id>.body`, src/i18n/real/whatsnew.<lang>.json).
 * Add a new entry at the top. The id is a name (a day and a number) and never changes: the seen mark and the words use it. `day` is
 * the day the entry's production release went live (owner, 2026-10-22), and the page shows the entries of each day under that date.
 *
 * `right` (UX audit 2026-10-19, chats-14): the page shows the entry only to a person who holds this right, so a Member does not read
 * what only the Admin can do. `to`: the address of the screen that the entry names. The page ends the entry with one quiet link
 * "Open", so the person does not search for the feature.
 */
export type WhatsNewEntry = { id: string; day: string; right?: Action; to?: string };

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  // The usage data line stays first (insight design, section 8): the team reads what Madar records before any other news.
  { id: '2026-10-23-102', day: '2026-10-25', to: '/settings' },
  // The "Needs first" list shows to the maker with task.details, also without task.assign (tsk_418). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-136', day: '2026-10-28' },
  // The Arabic Inbox chip "To-dos" got one word, so the four chips fit one row at 390 px (tsk_448). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-135', day: '2026-10-28' },
  // The security scan of 2026-10-28: F2 (a 10-digit code in reset and invitation links), F3 (a report id must name a real report),
  // F1 (Madar refuses an AI app that hides a return address) and F4 (the History of a deleted project). The lead sets the real
  // release day before the test deploy.
  { id: '2026-10-23-131', day: '2026-10-28' },
  { id: '2026-10-23-132', day: '2026-10-28', right: 'feedback.manage' },
  { id: '2026-10-23-133', day: '2026-10-28', right: 'ai.connect' },
  { id: '2026-10-23-134', day: '2026-10-28', right: 'admin.manage' },
  // The top bar marks Tasks on the to-do list, not Dashboard (tsk_488). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-130', day: '2026-10-28' },
  // A PDF in a chat or a comment opens a preview before it downloads (tsk_485). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-127', day: '2026-10-28' },
  // Insert a project file into a chat (fbk_070, tsk_482) and 500 MB for the files of a project (tsk_483). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-126', day: '2026-10-28' },
  { id: '2026-10-23-125', day: '2026-10-28' },
  // The chat icon of a to-do shows only the unread comments (fbk_071). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-124', day: '2026-10-28', to: '/work' },
  // A push that was planned before a person lost the view of a project no longer reaches the person (task tsk_439). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-123', day: '2026-10-28' },
  // The two fixes of the cleanup of the project page and of Settings (code review 2026-10-27). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-122', day: '2026-10-28', to: '/projects' },
  { id: '2026-10-23-121', day: '2026-10-28', right: 'people.turnOff' },
  // The AI assistant reads the chats before it answers about a project or a to-do (owner, 2026-10-27). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-120', day: '2026-10-27', right: 'ai.readChats' },
  // Five statuses for requests and bugs, and the reason of a rejected report (fbk_067). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-119', day: '2026-10-26' },
  { id: '2026-10-23-118', day: '2026-10-26', to: '/projects' },
  { id: '2026-10-23-117', day: '2026-10-26' },
  { id: '2026-10-23-116', day: '2026-10-26', to: '/settings' },
  { id: '2026-10-23-115', day: '2026-10-26' },
  { id: '2026-10-23-114', day: '2026-10-26', to: '/projects' },
  // The Daftra link (owner, 2026-10-26). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-113', day: '2026-10-26', right: 'payment.daftraLink' },
  { id: '2026-10-23-112', day: '2026-10-26', to: '/projects' },
  { id: '2026-10-23-111', day: '2026-10-26', to: '/projects' },
  { id: '2026-10-23-110', day: '2026-10-26', right: 'admin.manage', to: '/settings' },
  { id: '2026-10-23-109', day: '2026-10-26' },
  { id: '2026-10-23-108', day: '2026-10-26', to: '/projects' },
  { id: '2026-10-23-107', day: '2026-10-25' },
  { id: '2026-10-23-106', day: '2026-10-25', to: '/settings' },
  { id: '2026-10-23-105', day: '2026-10-25' },
  { id: '2026-10-23-104', day: '2026-10-25', right: 'dashboard.view', to: '/dashboard/space' },
  { id: '2026-10-23-103', day: '2026-10-25' },
  { id: '2026-10-23-101', day: '2026-10-25', right: 'ai.projectSetup' },
  { id: '2026-10-23-100', day: '2026-10-25', to: '/inbox' },
  { id: '2026-10-23-99', day: '2026-10-22' },
  { id: '2026-10-23-98', day: '2026-10-22', to: '/settings' },
  { id: '2026-10-23-97', day: '2026-10-22', to: '/inbox' },
  { id: '2026-10-23-96', day: '2026-10-22', to: '/settings' },
  { id: '2026-10-23-95', day: '2026-10-22', right: 'admin.manage', to: '/admin/roles' },
  { id: '2026-10-23-94', day: '2026-10-22', to: '/projects' },
  { id: '2026-10-23-93', day: '2026-10-22', to: '/projects' },
  { id: '2026-10-23-92', day: '2026-10-22' },
  { id: '2026-10-23-91', day: '2026-10-22', to: '/work' },
  { id: '2026-10-23-90', day: '2026-10-22', to: '/settings' },
  { id: '2026-10-23-89', day: '2026-10-22', to: '/inbox' },
  { id: '2026-10-23-88', day: '2026-10-22', to: '/settings' },
  { id: '2026-10-23-87', day: '2026-10-22', to: '/inbox' },
  { id: '2026-10-23-86', day: '2026-10-22', to: '/work' },
  { id: '2026-10-23-85', day: '2026-10-22', to: '/projects' },
  { id: '2026-10-23-84', day: '2026-10-22', to: '/projects' },
  { id: '2026-10-23-83', day: '2026-10-22', to: '/inbox' },
  { id: '2026-10-23-82', day: '2026-10-22' },
  { id: '2026-10-23-81', day: '2026-10-21', right: 'report.office' },
  { id: '2026-10-23-80', day: '2026-10-21', to: '/inbox' },
  { id: '2026-10-23-75', day: '2026-10-21', right: 'admin.manage', to: '/admin/roles' },
  { id: '2026-10-23-74', day: '2026-10-21', right: 'report.office' },
  { id: '2026-10-23-73', day: '2026-10-21', to: '/meetings' },
  { id: '2026-10-23-72', day: '2026-10-21' },
  { id: '2026-10-23-71', day: '2026-10-21', to: '/inbox' },
  { id: '2026-10-23-70', day: '2026-10-21', to: '/settings' },
  { id: '2026-10-23-69', day: '2026-10-20', right: 'admin.manage', to: '/settings' },
  { id: '2026-10-23-68', day: '2026-10-20', right: 'admin.manage', to: '/admin/roles' },
  { id: '2026-10-23-67', day: '2026-10-20', to: '/work' },
  { id: '2026-10-23-66', day: '2026-10-20', to: '/meetings' },
  { id: '2026-10-23-65', day: '2026-10-20', to: '/meetings' },
  { id: '2026-10-23-64', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-63', day: '2026-10-20', to: '/work' },
  { id: '2026-10-23-62', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-61', day: '2026-10-20', to: '/dashboard?view=map' },
  { id: '2026-10-23-60', day: '2026-10-20', to: '/projects' },
  { id: '2026-10-23-59', day: '2026-10-20' },
  { id: '2026-10-23-58', day: '2026-10-20' },
  { id: '2026-10-23-57', day: '2026-10-20', to: '/tasks' },
  { id: '2026-10-23-56', day: '2026-10-20', to: '/tasks' },
  { id: '2026-10-23-55', day: '2026-10-20', to: '/settings' },
  { id: '2026-10-23-54', day: '2026-10-20', to: '/meetings' },
  { id: '2026-10-23-32', day: '2026-10-20' },
  { id: '2026-10-23-31', day: '2026-10-20' },
  { id: '2026-10-23-29', day: '2026-10-20', right: 'templates.projectAny', to: '/admin/project-templates' },
  { id: '2026-10-23-28', day: '2026-10-20', to: '/settings' },
  { id: '2026-10-23-27', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-26', day: '2026-10-20', to: '/tasks' },
  { id: '2026-10-23-53', day: '2026-10-20', to: '/settings' },
  { id: '2026-10-23-52', day: '2026-10-20', to: '/meetings' },
  { id: '2026-10-23-51', day: '2026-10-20', right: 'admin.manage', to: '/inbox' },
  { id: '2026-10-23-50', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-40', day: '2026-10-20', to: '/search' },
  { id: '2026-10-23-30', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-25', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-24', day: '2026-10-20', to: '/inbox' },
  { id: '2026-10-23-23', day: '2026-10-20', to: '/projects' },
  { id: '2026-10-23-22', day: '2026-10-20', to: '/meetings' },
  { id: '2026-10-23-21', day: '2026-10-19', to: '/projects' },
  { id: '2026-10-23-20', day: '2026-10-19' },
  { id: '2026-10-23-19', day: '2026-10-19' },
  { id: '2026-10-23-18', day: '2026-10-19', to: '/dashboard?view=people' },
  { id: '2026-10-23-17', day: '2026-10-19', to: '/inbox' },
  { id: '2026-10-23-16', day: '2026-10-19' },
  { id: '2026-10-23-15', day: '2026-10-19' },
  { id: '2026-10-23-14', day: '2026-10-19', to: '/projects' },
  { id: '2026-10-23-13', day: '2026-10-19' },
  { id: '2026-10-23-1', day: '2026-10-19', to: '/projects' },
  { id: '2026-10-23-2', day: '2026-10-19', to: '/settings' },
  { id: '2026-10-23-3', day: '2026-10-19' },
  { id: '2026-10-23-4', day: '2026-10-19', to: '/inbox' },
  { id: '2026-10-23-5', day: '2026-10-19', to: '/inbox' },
  { id: '2026-10-23-6', day: '2026-10-19' },
  { id: '2026-10-23-7', day: '2026-10-19', right: 'admin.manage', to: '/admin/sub-companies' },
  { id: '2026-10-23-8', day: '2026-10-19', to: '/dashboard?view=map' },
  { id: '2026-10-23-9', day: '2026-10-19', to: '/dashboard/space' },
  { id: '2026-10-23-10', day: '2026-10-19', right: 'templates.projectAny', to: '/admin/project-templates' },
  { id: '2026-10-23-11', day: '2026-10-19', right: 'admin.manage', to: '/admin/roles' },
  { id: '2026-10-23-12', day: '2026-10-19', right: 'report.office' },
];
