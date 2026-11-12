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
  // The zod update of 2026-11-12 (the security questions of Faisal): the server refuses a very large request before it uses up its memory.
  { id: '2026-11-12-166', day: '2026-11-12' },
  // Open items of the review of 2026-11-10: a new person is not missing for a question from before they joined, and a place where a person signed in before keeps working when a stranger tries wrong passwords. The lead sets the real release day before the test deploy.
  { id: '2026-11-10-164', day: '2026-11-12' },
  // The move of VADO to the new servers (plan E, 2026-11-11): sign in once, connect an AI agent again once, and the connect screen keeps a long AI app name inside a phone screen.
  { id: '2026-11-11-165', day: '2026-11-11' },
  // Sign-in and weekly question fixes of the review of 2026-11-10: a stranger cannot lock a person out, a short network drop keeps the session, and the week of the team names as missing only the people who may answer. The lead sets the real release day before the test deploy.
  { id: '2026-11-10-163', day: '2026-11-11' },
  // The name and the logo of the company (Madar enterprises, plan C): the header, the mails and the push line show them. The first entry is for everyone, the second for the people who hold the switch Office settings. The lead sets the real release day before the test deploy.
  { id: '2026-11-08-162', day: '2026-11-08', right: 'office.settings', to: '/admin' },
  { id: '2026-11-08-161', day: '2026-11-08' },
  // Chat fixes (owner report 2026-11-08): helpers and people named with @ have the to-do thread, quiet hours are off unless a person turns them on, a longer swipe keeps the unread mark, a date line no longer lifts a thread. The lead sets the real release day before the test deploy.
  { id: '2026-11-08-160', day: '2026-11-08' },
  // The weekly question: Home asks what you plan on Sunday and what you did on Thursday, and the Week page shows the answers of the team (fbk_088, owner 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-159', day: '2026-11-08', to: '/week' },
  // A continuous project has no current stage: its header, rows, boxes and Overview show the open to-dos of each stage, and the order rules (a reason for a move back, the stage notice, the Activity line) are off. The To-dos tab gets a View button beside Filter, and the board of a continuous project has the stages as columns (fbk_084, fbk_085, owner 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-158', day: '2026-11-08' },
  // To-do names show on two lines in Today and in the lists; Today shows the project name, not its picture; the helper line is text for a screen reader only; a move to In review with nobody to review it is refused (fbk_083, tsk_692, owner 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-157', day: '2026-11-08' },
  // The lead of a to-do checks the work of its helpers; when the lead sends it, the project leader (or the maker of an office to-do) checks it; helpers can send a to-do to review (fbk_087, owner 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-156', day: '2026-11-08' },
  // Two small fixes (owner reports fbk_081, fbk_082): a reaction no longer moves the profile picture of the sender down in a chat, and the project view toggle on a desk Home is smaller and quieter. The lead sets the real release day before the test deploy.
  { id: '2026-11-08-155', day: '2026-11-08' },
  // Error and usage records go through the free managed proxy of PostHog on an own address, so an ad blocker does not stop them; what Madar records is the same (owner: "do the posthog proxy too", 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-154', day: '2026-11-08', to: '/settings' },
  // A read goes again by itself after a short server fault, so a bad Supabase worker shows a slow load and not "The data did not load" (owner: "fix it", 2026-11-08). The lead sets the real release day before the test deploy.
  { id: '2026-11-08-153', day: '2026-11-08' },
  // Resources: the files of the whole office (building codes, policies), opened from the Projects page (fbk_078, owner 2026-11-05). The lead sets the real release day before the test deploy.
  { id: '2026-11-05-152', day: '2026-11-05', to: '/resources' },
  // On a computer, every file preview (PDF, picture, Word, Excel) opens in one big window in the middle of the screen (fbk_079, owner 2026-11-05). The lead sets the real release day before the test deploy.
  { id: '2026-11-05-151', day: '2026-11-05' },
  // A project list shows rows or boxes by the choice of the person: the View button of Projects and a round toggle on Home (fbk_080, owner 2026-11-05). The lead sets the real release day before the test deploy.
  { id: '2026-11-05-150', day: '2026-11-05', to: '/projects' },
  // The switch Share files also holds for AI assistants in a project chat and on the comments of a to-do: without it, only files that the person or the agent uploaded (owner, 2026-11-03: "Server follows switch"). The lead sets the real release day before the test deploy.
  { id: '2026-11-03-148', day: '2026-11-03' },
  // A video (MP4, WebM, QuickTime) in a chat, a comment or Files & Links shows its first frame, and a press plays it on the full screen (owner, 2026-11-03). The lead sets the real release day before the test deploy.
  { id: '2026-11-03-147', day: '2026-11-03' },
  // Three fixes of Insert from a project (code review 2026-11-03): a reply with more than 10 files answers once, a turned-off person in a group blocks no project file, and the picker list reloads on a change of the rights or the teams. The lead sets the real release day before the test deploy.
  { id: '2026-11-03-146', day: '2026-11-03' },
  // A long name stays on a phone screen in the people lists of a new team and a new project: one base rule for every fieldset, and one column that can shrink in the Team list (after fbk_077). The lead sets the real release day before the test deploy.
  { id: '2026-11-02-145', day: '2026-11-02' },
  // A long stage name under "Needs first" stays in the stage box of the Stages list and ends with "..." (fbk_077). The lead sets the real release day before the test deploy.
  { id: '2026-11-02-144', day: '2026-11-02' },
  // A failed map file after a release reloads the page once, so a project page with a pin shows no error page (PostHog, tsk_501). The lead sets the real release day before the test deploy.
  { id: '2026-11-02-143', day: '2026-11-02' },
  // A quiet note shows the other to-dos of the lead in the same week, in the New to-do sheets and after a change in the to-do panel (tsk_499). The lead sets the real release day before the test deploy.
  { id: '2026-11-01-142', day: '2026-11-01' },
  // Word (.docx) and Excel (.xlsx) files open in the preview, in Files & Links, chats and comments (tsk_495, fbk_076). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-141', day: '2026-10-30' },
  // The Projects list shows the internal projects in their own group, and "Show first" puts a group on top (fbk_075). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-140', day: '2026-10-30', to: '/projects' },
  // Folders for the whole project and the Client documents folder (fbk_074, tsk_491, tsk_492). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-138', day: '2026-10-29' },
  // Locked folders and the locked Contract folder (fbk_074, tsk_492, tsk_493): only the holders of the switch read the entry. The lead sets the real release day before the test deploy.
  { id: '2026-10-23-139', day: '2026-10-29', right: 'folder.locked' },
  // The Schedule of the Dashboard shows the leader on each project row (fbk_073). The lead sets the real release day before the test deploy.
  { id: '2026-10-23-137', day: '2026-10-29', right: 'dashboard.view', to: '/dashboard?view=schedule' },
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
