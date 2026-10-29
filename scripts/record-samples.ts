import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { calls } from '../src/api/calls';
import { createApi } from '../src/api/client';
import { memoryPersister } from '../src/api/persist';
import { Store, type State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import { addDays, setNow } from '../src/lib/dates';
import { TASKS_CREATE_MANY, TASKS_UPDATE_MANY } from '../server/mcp/bulk';
import { PICTURES_GET } from '../server/mcp/pictures';
import { FEEDBACK_SEND_WITH_SCREENSHOTS, FILES_UPLOAD_CONTENT } from '../server/mcp/upload';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, READ_FIRST } from '../server/mcp/tools';

/**
 * Records one sample input for each MCP tool (plan 5.6, task G2) into server/mcp/samples.json.
 * Each sample is a real run: the script builds the sample office on a fixed day, acts as its agent (Madar Assistant, who acts
 * for the Admin), and calls every tool of the allowlist and the Admin list through the fake API with an input made from the
 * office's own IDs. A sample is kept only when its call succeeds. First a member sends one bug report, so the Admin tools have a
 * report to read. tools.test.ts then checks each tool's JSON Schema against these inputs, and that this file matches a new
 * recording.
 *
 *   npx tsx scripts/record-samples.ts          write server/mcp/samples.json
 *
 * Run it again after a contract change of an allowed call (the merge lead does after F2 merges).
 */

export const SAMPLES_PATH = fileURLToPath(new URL('../server/mcp/samples.json', import.meta.url));
const TODAY = '2026-09-30';
const NOW = new Date('2026-09-30T06:00:00Z');

type Sample = Record<string, unknown>;

function first<T>(items: T[], what: string): T {
  if (items.length === 0) throw new Error(`The sample office has no ${what}.`);
  return items[0];
}

/** The IDs that a call added to one collection of the office. */
function added(before: State, after: State, collection: 'tasks' | 'tracker' | 'payments' | 'deadlines' | 'meetings'): string {
  const old = before[collection] ?? {};
  const ids = Object.keys(after[collection] ?? {}).filter((id) => !(id in old));
  if (ids.length !== 1) throw new Error(`Expected one new record in ${collection}, found ${ids.length}.`);
  return ids[0];
}

export async function recordSamples(): Promise<Record<string, Sample>> {
  setNow(NOW);
  try {
    const state = await buildSeed(TODAY, async () => undefined);
    const persister = memoryPersister();
    const store = new Store(state, persister);
    const api = createApi(calls, { store, latencyMs: 0 });
    const callApi = api.call as (name: string, input: unknown, meta: { correlationId: string }) => Promise<unknown>;
    const s = () => store.state;

    const agent = first(Object.values(s().users).filter((u) => u.kind === 'agent' && u.active), 'agent');
    // A member sends a bug report with one screenshot. MCP denies feedback.send, so this is a direct call and records no sample.
    s().session.currentUserId = 'usr_003';
    const report = (await callApi('feedback.send', {
      kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects', screenshots: [new Blob(['x'], { type: 'image/png' })],
    }, { correlationId: 'cor_sample_fbk' })) as { id: string };
    s().session.currentUserId = agent.id;

    const samples: Record<string, Sample> = {};
    let n = 0;
    // Each call gets its own fixed correlation ID, so the recording is the same on every run.
    const run = async (name: string, input: Sample, storyId?: string): Promise<unknown> => {
      n += 1;
      const correlationId = storyId ?? `cor_sample_${String(n).padStart(3, '0')}`;
      const callInput = { ...input };
      delete callInput.storyId;
      try {
        const output = await callApi(name, callInput, { correlationId });
        samples[name] = input;
        return output;
      } catch (error) {
        // Name the call, so a failed sample is easy to find.
        const details = (error as { details?: unknown }).details;
        throw new Error(`record-samples: ${name} failed: ${(error as Error).message} ${JSON.stringify(details)}`, { cause: error });
      }
    };

    // The reads.
    const projects = Object.values(s().projects).filter((p) => p.status === 'active');
    const projectWith = (has: (id: string) => boolean, what: string) => first(projects.filter((p) => has(p.id)), what);
    const project = projectWith((id) => Object.values(s().tasks).some((t) => t.projectId === id) && Object.values(s().files).some((f) => f.projectId === id), 'active project with tasks and files');
    const task = first(Object.values(s().tasks).filter((t) => t.projectId === project.id), 'task');
    const commented = Object.values(s().comments).find((c) => c.targetType === 'task');
    samples[READ_FIRST] = {};
    // pictures.get has no call of its own (owner, 2026-10-21): its sample is the tile of the project.
    samples[PICTURES_GET] = { kind: 'projectTile', id: project.id };
    // The bulk tools have no call of their own (owner, 2026-10-26): each item is the input of tasks.create or tasks.update, so the samples are not run.
    samples[TASKS_CREATE_MANY] = { items: [{ projectId: project.id, title: 'Check the site drainage levels', stageId: project.currentStageId ?? undefined, ownerId: project.leaderId, dueDate: addDays(TODAY, 7) }] };
    samples[TASKS_UPDATE_MANY] = { items: [{ id: task.id, patch: { flagged: true } }] };
    // The upload tools have no call of their own (owner, 2026-10-26): they run the upload calls of the screens inside them, with a PUT to the file store, so the samples are not run.
    // 'UERGLTEuNA==' is the text "PDF-1.4" in base64.
    samples[FILES_UPLOAD_CONTENT] = { projectId: project.id, name: 'Site plan.pdf', type: 'application/pdf', contentBase64: 'UERGLTEuNA==' };
    samples[FEEDBACK_SEND_WITH_SCREENSHOTS] = {
      kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects', screenshots: [{ name: 'board.png', type: 'image/png', contentBase64: 'iVBORw0KGgo=' }],
    };
    await run('projects.list', { filter: 'all', sort: 'deadline' });
    await run('projects.get', { id: project.id });
    await run('tasks.list', { projectId: project.id, includeDone: true });
    await run('tasks.get', { id: task.id });
    await run('comments.list', { targetType: 'task', targetId: commented?.targetId ?? task.id });
    await run('updates.list', { projectId: project.id, filter: 'all', limit: 20 });
    await run('tracker.list', { projectId: projectWith((id) => Object.values(s().tracker ?? {}).some((e) => e.projectId === id), 'project with tracker entries').id, openOnly: false });
    await run('payments.list', { projectId: projectWith((id) => Object.values(s().payments ?? {}).some((p) => p.projectId === id), 'project with payments').id });
    await run('deadlines.list', { from: TODAY, to: addDays(TODAY, 90) });
    await run('files.list', { projectId: project.id });
    await run('users.list', { includeInactive: false });
    await run('subCompanies.list', {});
    // The lists for project set-up (owner, 2026-10-25): the clients and the project templates.
    await run('clients.list', {});
    await run('projectTemplates.list', {});
    await run('dashboard.get', { status: 'active' });
    await run('search.query', { text: project.name.split(' ')[0] });
    await run('events.list', { projectId: project.id, limit: 10 });
    await run('chats.list', {});
    // The chat reads of an agent (fbk_011, owner 2026-10-18): one page of the project chat, and what waits for the person's reply.
    const projectChat = first(Object.values(s().conversations).filter((c) => c.kind === 'project' && c.projectId === project.id), 'project chat');
    await run('chats.messages', { conversationId: projectChat.id, limit: 20 });
    await run('chats.waiting', {});
    // The reads of an agent of an Admin. feedback.list goes with no filter, so the sample does not need the status input.
    await run('feedback.list', {});
    await run('feedback.screenshot', { id: report.id, index: 0 });
    // The office report of one month (fbk_016). The agent acts for the Admin, who holds the report right.
    await run('reports.office', { period: 'month' });

    // The writes, all in one story, so the last sample takes the whole story back.
    const { storyId } = (await run('story.start', {})) as { storyId: string };
    const stageId = project.currentStageId ?? first(Object.values(s().stages).filter((st) => st.projectId === project.id), 'stage').id;
    const write = async (name: string, input: Sample) => run(name, { ...input, storyId }, storyId);
    const snapshot = () => structuredClone(s());

    let before = snapshot();
    await write('tasks.create', { projectId: project.id, title: 'Check the site drainage levels', stageId, ownerId: project.leaderId, dueDate: addDays(TODAY, 7) });
    const newTask = added(before, s(), 'tasks');
    await write('tasks.update', { id: newTask, patch: { description: 'Compare the levels with the survey of August.', flagged: true } });
    // The sample office has no task with no lead, so the script takes the lead off one open task before it takes it.
    const unled = first(Object.values(s().tasks).filter((t) => t.projectId === project.id && t.status === 'todo' && t.id !== newTask), 'open task');
    s().tasks[unled.id].ownerId = null;
    await write('tasks.take', { taskId: unled.id });
    // The join as a helper (fbk_035): one open task of the project that the person neither leads nor helps on.
    const helpOn = first(Object.values(s().tasks).filter((t) => t.projectId === project.id && t.status !== 'done' && t.ownerId !== null
      && t.ownerId !== agent.ownerId && !(t.helperIds ?? []).includes(agent.ownerId ?? '')), 'task to help on');
    await write('tasks.help', { taskId: helpOn.id, help: true });
    await write('tasks.arrange', { ids: [unled.id, newTask], moved: unled.id });
    await write('tasks.move', { id: newTask, status: 'in_progress' });
    await write('tasks.complete', { id: newTask });
    await write('comments.create', { targetType: 'task', targetId: newTask, body: 'The levels match the survey.' });
    await write('updates.create', { projectId: project.id, body: 'The drainage check is done. The levels match the survey.' });
    // The message tools (owner, 2026-10-12): the direct chat with one other active person, then one message into it.
    const colleague = first(Object.values(s().users).filter((u) => u.kind === 'human' && u.active && u.id !== agent.ownerId), 'person to message');
    const chat = (await write('chats.openDirect', { userId: colleague.id })) as { id: string };
    await write('chats.send', { conversationId: chat.id, body: 'The drainage check is done. I posted the result on the project.' });

    // A client meeting of the project with one colleague (fbk_022): the list and the read come right after it, then a change and the cancel.
    before = snapshot();
    await write('meetings.create', {
      kind: 'client', title: 'Review the drainage report with the client', projectId: project.id, startsAt: `${addDays(TODAY, 4)}T10:00:00+03:00`,
      where: 'Client office, Al Khobar', attendeeIds: [colleague.id],
    });
    const meeting = added(before, s(), 'meetings');
    await run('meetings.list', { from: TODAY, to: addDays(TODAY, 30), projectId: project.id });
    await run('meetings.get', { id: meeting });
    await write('meetings.update', { id: meeting, where: 'Site office' });
    await write('meetings.cancel', { id: meeting });
    // The minutes of a meeting that ended (wave 2). The agent plans a client meeting of the project two days ago, and writes its minutes. Both calls
    // stay out of the story: the mark of a settled meeting has no Undo, so the Undo of the story could not take the meeting back.
    before = snapshot();
    await callApi('meetings.create', {
      kind: 'client', title: 'Kick-off with the client', projectId: project.id, startsAt: `${addDays(TODAY, -2)}T10:00:00+03:00`, where: 'Client office, Al Khobar',
      attendeeIds: [colleague.id],
    }, { correlationId: 'cor_sample_past_meeting' });
    const ended = added(before, s(), 'meetings');
    await run('meetings.saveMinutes', { id: ended, text: 'The client accepted the three facade options. We send the drawings on Sunday.', fileIds: [], since: null });

    const inReview = Object.values(s().tasks).filter((t) => t.status === 'in_review' && s().projects[t.projectId!]?.status === 'active');
    await write('tasks.approve', { id: first(inReview, 'task in review').id });
    await write('tasks.sendBack', { id: first(inReview.slice(1), 'second task in review').id, note: 'Add the section through the stair, then send it again.' });

    before = snapshot();
    await write('tracker.log', { projectId: project.id, type: 'message', direction: 'out', title: 'Sent the drainage report to the client', waiting: 'client', date: TODAY });
    const entry = added(before, s(), 'tracker');
    await write('tracker.update', { id: entry, note: 'The client asked for one week to reply.' });
    await write('tracker.close', { id: entry });

    before = snapshot();
    await write('payments.create', { projectId: project.id, name: 'Design development fee', amount: 25000, dueDate: addDays(TODAY, 30) });
    const payment = added(before, s(), 'payments');
    await write('payments.update', { id: payment, patch: { note: 'Invoice 2026-118' } });
    await write('payments.markReceived', { id: payment, receivedOn: TODAY });

    before = snapshot();
    await write('deadlines.create', { projectId: project.id, name: 'Municipality submission', date: addDays(TODAY, 21), stageId });
    const deadline = added(before, s(), 'deadlines');
    await write('deadlines.update', { id: deadline, patch: { date: addDays(TODAY, 28) } });
    // The dates of the current stage (fbk_023): both dates go in, the end a week later. A stage date needs no reason.
    const currentStage = s().stages[stageId];
    await write('stages.setDates', { stageId, startDate: currentStage.startDate ?? TODAY, endDate: addDays(currentStage.endDate ?? addDays(TODAY, 30), 7) });
    // The folders of the Files & Links tab (fbk_066): make one in the current stage, rename it, move a file into it, and delete it (the file goes back
    // to the root of its stage). The Undo of the story takes all of it back.
    await write('folders.create', { projectId: project.id, stageId, name: 'Mood boarding' });
    const folderId = first((s().projects[project.id].folders ?? []).filter((f) => f.name === 'Mood boarding'), 'new folder').id;
    await write('folders.rename', { id: folderId, name: 'Mood board' });
    // The lock (fbk_074): the Admin of the sample run holds the switch, and the folder is open, so this call changes nothing.
    await write('folders.setLock', { id: folderId, locked: false });
    const projectFile = first(Object.values(s().files).filter((f) => f.projectId === project.id), 'file of the project');
    await write('files.move', { id: projectFile.id, stageId, folderId });
    await write('folders.delete', { id: folderId });
    await write('projects.update', { id: project.id, patch: { description: 'A four-storey office building with a basement car park.' } });
    await write('feedback.setStatus', { id: report.id, status: 'done' });

    // A status change on its own, then its Undo by event ID.
    const other = first(projects.filter((p) => p.id !== project.id), 'second active project');
    await run('projects.setStatus', { id: other.id, status: 'completed' });
    const statusEvent = first(Object.values(s().events).filter((e) => e.targetType === 'project' && e.targetId === other.id && e.correlationId === `cor_sample_${String(n).padStart(3, '0')}`), 'status event');
    await run('events.undo', { eventId: statusEvent.id });

    await run('events.undoStory', { correlationId: storyId });

    // The tools of the MCP parity track (owner, 2026-10-26). They come after the Undo of the story and stay out of it: a change to a person, a
    // role or a sub-company cannot be undone by an agent, a message has no Undo, and a new project is not undoable either. Each run needs a record
    // to work on, so the script makes it with a direct call (callApi) that records no sample.
    const owner = agent.ownerId ?? '';
    const make = async <T,>(name: string, input: Sample): Promise<T> => callApi(name, input, { correlationId: `cor_sample_make_${name}_${Object.keys(input).length}_${n}` }) as Promise<T>;
    const stageOf = s().stages[stageId];

    // Project set-up. The leader stays the same person. A pause, its new restart date and the resume come one after the other.
    await run('projects.setLeader', { id: project.id, leaderId: project.leaderId });
    await run('projects.pause', { id: project.id, reason: 'The client has not sent the survey yet.', resumeOn: addDays(TODAY, 20), kind: 'internal' });
    await run('projects.setRestart', { id: project.id, resumeOn: addDays(TODAY, 25) });
    await run('projects.resume', { id: project.id });
    await run('projects.setAccess', { id: project.id, hidden: false, viewerIds: [] });
    await run('projects.addLink', { projectId: project.id, kind: 'moodboard', label: 'Moodboard', url: 'https://example.com/moodboard' });
    const link = (s().projects[project.id].links ?? []).slice(-1)[0];
    await run('projects.updateLink', { projectId: project.id, linkId: link.id, label: 'Moodboard, second round' });
    await run('projects.removeLink', { projectId: project.id, linkId: link.id });
    await run('projects.setHealthOverride', { id: project.id, value: 'at_risk', reason: 'The survey of the site is late.' });
    await run('projects.clearHealthOverride', { id: project.id });
    const onTeam = new Set(Object.values(s().members).filter((m) => m.projectId === project.id).map((m) => m.userId));
    const newcomer = first(Object.values(s().users).filter((u) => u.kind === 'human' && u.active && !onTeam.has(u.id) && u.id !== agent.ownerId), 'person outside the team');
    await run('members.add', { projectId: project.id, userId: newcomer.id, discipline: 'Architect' });
    await run('members.update', { projectId: project.id, userId: newcomer.id, discipline: 'Site engineer' });
    await run('members.remove', { projectId: project.id, userId: newcomer.id });
    await run('teams.create', { name: 'Site visits', memberIds: [colleague.id] });
    const team = first(Object.values(s().teams ?? {}).filter((t) => t.name === 'Site visits'), 'new team');
    await run('members.addTeam', { projectId: project.id, teamId: team.id });
    const ordered = Object.values(s().stages).filter((st) => st.projectId === project.id).sort((a, b) => a.order - b.order);
    await run('stages.setPrerequisites', { stageId: ordered[1].id, prerequisiteIds: [ordered[0].id] });
    await make('deadlines.create', { projectId: project.id, name: 'Sample deadline to delete', date: addDays(TODAY, 40) });
    const spareDeadline = first(Object.values(s().deadlines).filter((d) => d.name === 'Sample deadline to delete'), 'new deadline');
    await run('deadlines.delete', { id: spareDeadline.id });

    // To-dos: a template, a to-do from it, a new version of a finished to-do, the delete, and the template calls.
    await run('taskTemplates.save', { name: 'Check the drainage levels', stageName: stageOf.name, description: 'Compare the levels with the survey.', checklist: ['Read the survey', 'Compare the levels'], needsReview: true, schedule: 'static' });
    const template = first(Object.values(s().taskTemplates ?? {}).filter((t) => t.name === 'Check the drainage levels'), 'new task template');
    await run('taskTemplates.list', { stageName: stageOf.name });
    await run('taskTemplates.rename', { id: template.id, name: 'Check the drainage levels again' });
    await run('tasks.createFromTemplate', { templateId: template.id, stageId, ownerId: project.leaderId ?? undefined });
    const fromTemplate = first(Object.values(s().tasks).filter((t) => t.title === 'Check the drainage levels again'), 'task from the template');
    const doneTask = first(Object.values(s().tasks).filter((t) => t.projectId === project.id && t.status === 'done'), 'done task');
    await run('tasks.newVersion', { id: doneTask.id, reason: 'The client asked for a change to the plan.' });
    await run('tasks.delete', { id: fromTemplate.id });
    await run('taskTemplates.delete', { id: template.id });

    // Posts, comments, reactions and messages of the person (the calls allow the author only).
    const post = await make<{ id: string }>('updates.create', { projectId: project.id, body: 'A post to change.' });
    await run('updates.update', { id: post.id, body: 'A post to change, with the new levels.' });
    await run('updates.delete', { id: post.id });
    const comment = await make<{ comment: { id: string } }>('comments.create', { targetType: 'task', targetId: task.id, body: 'A comment to change.' });
    await run('comments.update', { id: comment.comment.id, body: 'A comment to change, with the new levels.' });
    await run('reactions.toggle', { commentId: comment.comment.id, emoji: '👍' });
    await run('comments.delete', { id: comment.comment.id });
    const message = await make<{ message: { id: string } }>('chats.send', { conversationId: chat.id, body: 'A message to change.' });
    await run('chats.editMessage', { id: message.message.id, body: 'A message to change, with the new levels.' });
    await run('chats.deleteMessage', { id: message.message.id });
    const group = (await run('chats.createGroup', { name: 'Site team', memberIds: [colleague.id, newcomer.id] })) as { id: string };
    await run('chats.updateGroup', { conversationId: group.id, name: 'Site team, Al Khobar' });
    await run('chats.leaveGroup', { conversationId: group.id });

    // Files without upload. The script gives one file its data, so the link can open it.
    const sampleFile = first(Object.values(s().files).filter((f) => f.projectId === project.id), 'file of the project');
    await persister.putBlob(sampleFile.versions[sampleFile.versions.length - 1].blobKey, new Blob(['x'], { type: 'image/png' }));
    await run('files.link', { id: sampleFile.id, variant: 'full', disposition: 'inline' });
    await run('files.markDelivered', { id: sampleFile.id });
    await run('files.share', { fileId: sampleFile.id, target: { kind: 'project_chat' }, message: 'The latest drawing.' });
    await run('files.delete', { id: sampleFile.id });

    // The bell, the read marks and the own chat state of the person.
    const notice = first(Object.values(s().notifications).filter((n) => n.userId === agent.ownerId), 'notice of the person');
    await run('notifications.list', { unreadOnly: false, limit: 20 });
    await run('notifications.count', {});
    await run('notifications.markRead', { ids: [notice.id] });
    await run('notifications.markUnread', { ids: [notice.id] });
    await run('notifications.markAllRead', {});
    await run('notifications.updateSettings', { channel: 'app', trigger: 'mention', on: true });
    await run('chats.unreadCount', {});
    await run('chats.markRead', { conversationId: projectChat.id });
    await run('chats.markUnread', { conversationId: projectChat.id });
    await run('chats.setNotify', { conversationId: projectChat.id, notify: 'named' });
    await run('chats.archive', { conversationId: projectChat.id, archived: true });

    // Templates of stages and projects.
    await run('stageTemplates.save', { name: 'Small villa stages', stages: ['Concept', 'Design', 'Documents'] });
    await run('stageTemplates.list', {});
    const stageTemplate = first(Object.values(s().stageTemplates ?? {}).filter((t) => t.name === 'Small villa stages'), 'new stage template');
    await run('stageTemplates.delete', { id: stageTemplate.id });
    const baseTemplate = first(Object.values(s().projectTemplates ?? {}), 'project template');
    const parts = { name: baseTemplate.name, roles: baseTemplate.roles, stages: baseTemplate.stages, tasks: baseTemplate.tasks };
    await run('projectTemplates.save', { id: baseTemplate.id, ...parts });
    const copy = await make<{ id: string }>('projectTemplates.save', { ...parts, name: `${baseTemplate.name}, copy` });
    await run('projectTemplates.delete', { id: copy.id });
    await run('projectTemplates.usage', { templateId: baseTemplate.id });
    const open = first(projects.filter((p) => p.id !== project.id && p.id !== other.id), 'open project for the template');
    await run('projectTemplates.matchPlan', { projectId: open.id, templateId: baseTemplate.id });
    await run('projectTemplates.syncPlan', { templateId: baseTemplate.id, projectIds: [open.id] });
    await run('projectTemplates.link', { projectId: open.id, templateId: baseTemplate.id, stageMatches: {}, taskMatches: {}, rolePeople: {}, replace: false });
    await run('projectTemplates.syncApply', {
      templateId: baseTemplate.id, projectId: open.id,
      choices: { add: false, bringBack: false, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false },
    });

    // Tracker, payments and meetings.
    const waiting = await make<{ entry: { id: string } }>('tracker.log', { projectId: project.id, type: 'message', direction: 'in', title: 'The client asked for the revised plan', waiting: 'us', date: TODAY });
    await run('tracker.assignReply', { id: waiting.entry.id, userId: colleague.id, dueDate: addDays(TODAY, 3) });
    await run('tracker.export', { projectId: project.id });
    await run('tracker.delete', { id: waiting.entry.id });
    await make('payments.create', { projectId: project.id, name: 'Sample fee to delete', amount: 1000, dueDate: addDays(TODAY, 60) });
    const spent = first(Object.values(s().payments ?? {}).filter((p) => p.name === 'Sample fee to delete'), 'payment to delete');
    await run('payments.delete', { id: spent.id });
    await make('meetings.create', { kind: 'team', title: 'Sample meeting to delete', startsAt: `${addDays(TODAY, 6)}T09:00:00+03:00` });
    const gone = first(Object.values(s().meetings ?? {}).filter((m) => m.title === 'Sample meeting to delete'), 'meeting to delete');
    await make('meetings.cancel', { id: gone.id });
    await run('meetings.delete', { id: gone.id });

    // The own profile, preferences, requests and AI apps of the person.
    await run('me.updateProfile', { nameAr: s().users[owner].nameAr ?? 'أسامة' });
    await run('me.updatePreferences', { theme: 'dark' });
    await run('feedback.send', { kind: 'feature', message: 'Add a print view to the Tracker.', page: '/projects' });
    await run('agents.list', {});
    const spareAgent = await make<{ id: string }>('users.create', { name: 'Spare Agent', email: 'spare.agent@madar.test', kind: 'agent', ownerId: owner, discipline: 'Assistant' });
    await run('agents.remove', { agentId: spareAgent.id });

    // Admin work. The agent acts for the Admin, who holds every right.
    await run('users.create', { name: 'Layla Hassan', nameAr: 'ليلى حسن', email: 'layla.hassan@madar.test', discipline: 'Architect', systemRole: 'member', language: 'en' });
    const layla = first(Object.values(s().users).filter((u) => u.email === 'layla.hassan@madar.test'), 'new person');
    await run('users.get', { id: layla.id });
    await run('users.update', { id: layla.id, patch: { discipline: 'Site engineer' } });
    await run('users.invites', {});
    await run('users.resendInvite', { id: layla.id });
    await run('users.deactivate', { id: layla.id });
    await run('users.reactivate', { id: layla.id });
    await make('users.deactivate', { id: layla.id });
    await run('users.remove', { id: layla.id });
    const oldClient = first(Object.values(s().clients), 'client');
    await run('clients.update', { id: oldClient.id, patch: { phone: '+966 13 555 0100' } });
    await run('teams.list', {});
    await run('teams.update', { id: team.id, name: 'Site visits and surveys' });
    await run('teams.delete', { id: team.id });
    await run('subCompanies.save', { name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: null });
    const subCompany = first(Object.values(s().subCompanies ?? {}).filter((c) => c.name === 'Marsa Design'), 'new sub-company');
    await run('subCompanies.delete', { id: subCompany.id, moveToId: null });
    await run('settings.get', {});
    await run('settings.update', { staleAfterDays: s().settings.staleAfterDays });
    await run('roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] });
    const role = first((s().settings.roles?.custom ?? []).filter((r) => r.name === 'Site supervisors'), 'new role');
    await run('roles.update', { role: role.id, name: 'Site supervisors, Al Khobar' });
    await run('roles.delete', { id: role.id });
    // The stages of the project (owner, 2026-10-26): the whole list in its order, the id of each stage that stays, one stage renamed. It stays out of the
    // story: a change of stages has no Undo, so a story that holds it cannot be taken back. It comes after the Undo of the story.
    const stageList = Object.values(s().stages).filter((st) => st.projectId === project.id).sort((a, b) => a.order - b.order);
    await run('stages.replace', {
      projectId: project.id,
      stages: stageList.map((st, i) => ({ id: st.id, name: i === stageList.length - 1 ? `${st.name} and handover` : st.name, startDate: st.startDate, endDate: st.endDate })),
    });
    // A new client and a new project (owner, 2026-10-25). Both stay out of the story: a new project has no Undo, so a story that holds it
    // cannot be taken back. They come after the Undo of the story.
    await run('clients.create', { name: 'Harbour View Developments', nameAr: 'مطورو هاربر فيو', initials: 'HVD' });
    const newClient = first(Object.values(s().clients).filter((c) => c.initials === 'HVD'), 'new client');
    await run('projects.create', {
      name: 'Harbour View Offices', clientId: newClient.id, leader: 'me', teamIds: [colleague.id],
      codeParts: { initials: 'HVD', classification: 'COM', type: 'Office' }, startDate: addDays(TODAY, 14), targetEndDate: addDays(TODAY, 300),
    });

    const missing = [...MCP_ALLOW, ...MCP_ADMIN, ...Object.keys(MCP_BY_RIGHT)].filter((name) => !(name in samples));
    if (missing.length > 0) throw new Error(`No sample for: ${missing.join(', ')}`);
    return Object.fromEntries(Object.keys(samples).sort().map((name) => [name, samples[name]]));
  } finally {
    setNow(null);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const samples = await recordSamples();
  writeFileSync(SAMPLES_PATH, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`record-samples: wrote ${Object.keys(samples).length} samples to ${SAMPLES_PATH}`);
}
