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
| B3b | Overview: awaiting payment, only for management and accounting | Approved, reversing the 30 Sept "no fees" decision: add Management and Accounting roles and simple payment milestones visible only to them | in progress |
