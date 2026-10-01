# Colleague's comments on the Madar prototype (2026-10-01)

Source: `~/Downloads/madar comments.docx`, 17 comments in 4 groups. The owner decides each one; this file records the decision and what was built.

| # | Comment | Decision | Built |
|---|---------|----------|-------|
| A1 | Projects list: move the stage to its own column | Approved: one Stage column, the stage name with the stage steps under it | 71c203d |
| A2 | Projects list: a column of assignee pictures, the leader bigger | Approved: leader 30 px, up to 3 team members 26 px, then +N; on hover they slide apart and show names | 4aff24c |
| A3 | Projects list: remove the project picture | Kept for now: the colleague saw the old letter tiles; show them the new Glow shapes first | none |
| B1 | Project: a "Tracker" tab for every exchange with the client, filterable, MCP friendly | Approved in an ADHD-friendly form: open loops on top (waiting for our reply / waiting for the client), one-line log with 4 types (Meeting, Message, File, Balady) and a From/To switch, automatic entries for client files, weekly history, one Filter button. Built as one merge so it can be rolled back (`git revert -m 1 3b26c75`) | 3b26c75 |
| B2 | Project overview: links to the Pinterest board, drive folders, map pin, client delivery folder | Approved: a Links list in the About panel, 5 kinds with icons, only filled links show, Copy for network paths, web links only | 77c6bf2, 335a00a |
| B3a | Overview: highlight pending files from the client (land survey, soil report) | Approved: Needs attention lists the Tracker's open "Waiting for the client" items with age and one-press Received | this commit |
| B3b | Overview: awaiting payment, only for management and accounting | Approved, reversing the 30 Sept "no fees" decision: add Management and Accounting roles and simple payment milestones visible only to them | edc2421 |
| B4 | Overview: contract start date; payment received dates for management | Approved: contract start date for everyone; payment milestones with due and received dates only for Management and Accounting | edc2421 |
| D5 | Admin and management roles create user profiles | Approved: Management may add people and set roles, never Admin; only the Admin creates AI agents (security) | edc2421 |
| (owner) | Tasks: a start date, and static (start + due date) or dynamic (start + duration) | Owner's own request during the review: durations count working days, Sunday to Thursday | 365fafe |
| C1 + D4 | Task templates and subtasks; templates saved to one stage only | Approved: save a task (title, description, checklist, review step) as a template for one stage; only that stage offers it; Admin manages them; subtasks stay the checklist | merged after 57a73f9 |
| C1 | Task versions (client comments reopen a finished task with its subtasks, new dates, logged in the tracker) | Approved: "New version" reopens the same task as Version N, unticks the checklist, asks why and for new dates, logs a Tracker entry, keeps one comment thread and a version history | merged after 57a73f9 |
| C2 | Tasks assigned to one or more people; assigning adds the person to the project | Approved as lead + helpers: one lead finishes the task (shown first and bigger), helpers see it in their Tasks; when the leader or Admin assigns someone outside the team, Madar adds them and tells them | merged after 57a73f9 |
| D1 + D2 | New client: "same" tick box when the client is the contact; client name in English and Arabic | Approved: two name fields (one required), the name shows in the screen language; "Same as client" fills and locks the contact | this commit |
| D3 | Revert the project stage manually (Permits back to Construction Documents) | Approved: picking an earlier stage reads "Move back to …" and needs a reason; the Overview shows when and why until the project moves forward; an optional tick box logs it in the Tracker as a Balady update | this commit |
| D6 | Teams: one person in several teams | Approved: office teams on the Admin page (Admin and Management), "Add a team" on a project's Team tab, a Team choice in the Filter of Projects, Dashboard and the meeting view; no team mentions or chats | 1449605 |
| D7 | Project health: pause with reasoning, awaiting client (also pauses), stale after X days (Admin setting) | Pause existed; approved: the pause asks "Our side" or "Awaiting client" (own sign + a Tracker "waiting for the client" item closed on resume); "Stale" sign after N paused days (Admin setting, default 30) and in the Dashboard attention list | 1449605 |

Note: the document has 16 comments (A1-A3, B1-B4, C1-C2, D1-D7). An early chat message said 17 by mistake.

Also built during the review at the owner's request: task start dates (static or dynamic), one-color people pictures, the tray Inbox icon (animated), and "Request a feature or report a bug" in the person menu.
