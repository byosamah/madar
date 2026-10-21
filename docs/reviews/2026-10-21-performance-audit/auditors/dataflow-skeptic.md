# Skeptic verdicts: dataflow (commit 1d45aae5, code read in deploy-test)

DF-1 weakened (4 to 3), fix not safe as written. Code holds: tasks.list, meetings.list, projects.list have no projectId, so
affects() (signals.ts:75-88) returns true for any project. But the month figure is an upper bound: it takes the busiest day
(19 Oct, team week, 2,900 Realtime messages, so about 200 signals) times 22 days, with 12 visible tabs all day. Chat messages
cost 1 call a tab, not 1.9 requests. The earlier record says production made about 422 server calls a day (13,000 a month,
design spec line 213). A mixed day gives 30,000 to 50,000 calls a month, 6 to 10 percent, and the fix saves only the part for
projects a person has no row in. Fix risk: a task that is newly assigned in a project where the person holds no row is found
only through the notice signal, and tasks.list does not list 'notifications' in readMap.ts, so affects() line 83 does not
reload it. An agent or self-assign gives no notice. The fix needs a readMap change and the generated test first.

DF-14 weakened (4 to 3). Confirmed: no persister (no persistQueryClient in src), Home returns null until session, mine and
review answer (HomeScreen.tsx:151). The gain is real but 4 to 20 phone relaunches a day is inferred, the JS download still
comes first, and the fix puts client data at rest on the device (security and stale-number cost, owner decision).

DF-2 weakened (3 to 2). Confirmed in code (readMap.ts:92,94; scope person, kinds include messages). Only the anonymous
direct chat signal is avoidable: a project chat message must still reach everybody who can open that chat. Volume is 60 to
250 messages a day in the finding itself, so 10,000 to 40,000 calls a month at most, and 1 call joins an existing batch on
Home, Tasks, Projects. Fix needs a server change in who hears a direct message (INT-16): the client alone cannot do it.

DF-3 weakened (3 to 2), fix unsafe. Confirmed: channel.ts:109 tells join and signals.ts:293 turns it into all. The repeat
returns the same data (structural sharing), so nothing re-renders. The fix does not reach its goal: the socket needs about
0.72 s from its start, the first Home reads end at about 0.53 s, so the join still comes after the reads even when the socket
starts at time 0. The join reload is also the guard for a change saved between the read and the join.

DF-5 confirmed (3). Read: NewProjectSheet.tsx:28-34 mounts for everyone who may create and reads without a gate;
ApplyTemplateSheet.tsx:28 reads for everyone on every project page; EditProjectSheet.tsx:48 reads for the Admin. Measured
copy output: Projects 11 calls, 2 round trips became 9 calls, 1 round trip. Fix is safe. A template picker can pop in late on
the first open: start the reads on pointerdown (as proposed).

DF-6 weakened (3 to 2). Confirmed: MeetingsCard mounts after HomeScreen returns null (HomeScreen.tsx:151). But the card draws
nothing on a day with no meeting, the request count of a member Home goes from 4 to 3 only (an admin stays at 4, round 2 still
holds projects.list all), and the card shows 0.4 s later only on meeting days.

DF-7 confirmed (2). RequireRight returns null until session.get answers (useRight.tsx:26-31). It hits only a cold open of
Dashboard, Meeting view, Open Space and Admin (a reload, a phone relaunch on that screen). In-app navigation has the session
cached. A speculative read for a person without the right is refused by the server, so security stays.

DF-8 weakened (3 to 2). Confirmed: LiveProvider.tsx:33 watches every active human. Face with state of others: Inbox and also
MentionField (composers outside the Inbox), so a use count is needed, not an Inbox-only switch. The owner already booked the
total at about 45 percent of the 2M Realtime messages (proof.md 2026-10-21, TASKS.md). The 100 messages a second claim is
not tested. Fix shows dots up to 1.5 s late (behavior change, flagged).

DF-9 weakened (2 to 1). Confirmed in code (activity.ts:13-16). But "a tab out of view is Away at once" is a written owner
rule (chat presence design, line 65). It overlaps DF-8 (same listeners): the two savings do not add. Quota only.

DF-10 weakened (2 to 1). Confirmed in code (typing.ts:128-166). The 66,000 calls a month comes from the design guess of 3,000
signals a day. The finding's own chat volume (60 to 250 messages a day, a few signals each) gives 4,000 to 16,000 a month.
Fix is safe in effect; one edge: a visible but idle (Away) reader would miss the typing line.

DF-4 confirmed (2), fix partly unsafe. Code holds (signals.ts:330) and the double pass is real: a refetch with data cancels
and restarts the running fetch. The part "merge a join pass into a visibility pass of the last second" is safe. The part "skip
the 60 s pass when the socket stayed open" is not: status() is only the SUBSCRIBED flags (channel.ts:158) and a socket of a
sleeping laptop or a phone looks open until the heartbeat fails, so lists stay old for up to a minute. Safe form: skip only
for hidden times under about 5 minutes (before the browser slows timers), never after a phone or a sleep.

DF-11 confirmed (2). usePushDevice runs syncThisDevice in an effect at each mount (usePushDevice.ts:41-47), which calls
push.mine (push.ts:209). PushAskCard mounts at each Home visit. PushSync adds one at 3 s. About 5,000 to 10,000 calls a month.

DF-12 weakened (2 to 1). The Edge call claim is wrong: platform-facts.md line 110 quotes Supabase: preflight (OPTIONS)
requests are not billed. The 3 preflights run in parallel, so they cost one round trip, not three. The 2026-10-08 audit
measured the forwarder as not faster over a session. The iPhone cache limit is not measured. Fix needs a real iPhone measure.

DF-13 confirmed (1). TasksTab.tsx:95 gates on viewerCan.addTask from projects.get. It matters only for a cold deep link to
?tab=tasks (in-app, projects.get is cached). A prefetch gated on the session right would read templates for a person who
cannot add on that project (small waste, same security).

DF-15 weakened (1), fix not safe. Dropping chats.messages after chats.markRead is wrong: ChatThread.readUpTo is the reader's
own lastReadAt (handlers/chats.ts:321), so the follow read keeps the New line right. Without it a reopened chat shows a stale
New line from the cache. The search pause 150 to 250 ms changes feel. The Home save count (3 calls) comes from the one
overview read per request rule (wire.ts:53).
