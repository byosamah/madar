import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { calls } from '../src/api/calls';
import { createApi } from '../src/api/client';
import { memoryPersister } from '../src/api/persist';
import { Store, type State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import { addDays, setNow } from '../src/lib/dates';
import { PICTURES_GET } from '../server/mcp/pictures';
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
    const store = new Store(state, memoryPersister());
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
      const output = await callApi(name, callInput, { correlationId });
      samples[name] = input;
      return output;
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
    await write('projects.update', { id: project.id, patch: { description: 'A four-storey office building with a basement car park.' } });
    await write('feedback.setStatus', { id: report.id, status: 'done' });

    // A status change on its own, then its Undo by event ID.
    const other = first(projects.filter((p) => p.id !== project.id), 'second active project');
    await run('projects.setStatus', { id: other.id, status: 'completed' });
    const statusEvent = first(Object.values(s().events).filter((e) => e.targetType === 'project' && e.targetId === other.id && e.correlationId === `cor_sample_${String(n).padStart(3, '0')}`), 'status event');
    await run('events.undo', { eventId: statusEvent.id });

    await run('events.undoStory', { correlationId: storyId });

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
