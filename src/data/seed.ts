import { addDirectConversation, addProjectConversation } from '../api/chatState';
import { chatReadKey, emptyState, memberKey, nextId, type State } from '../api/store';
import {
  defaultPreferences, emptyReactions, type FileRec, type FileVersion, type Project, type Task, type TrackerEntry, type User,
  type LinkKind,
} from '../api/contract/entities';
import { writeEvent, type EventContext } from '../api/events';
import { notify, reviewersOf } from '../api/notify';
import { addDays, dayOfWeek, diffDays, maxDay, minDay, weekStartOf } from '../lib/dates';
import { mentionMarkup } from '../lib/text';
import { isWorkingDay } from '../lib/workdays';
import { pickMark } from '../lib/projectMark';
import { drawingPdf, renderSvg } from './assets';

export type PutBlob = (key: string, blob: Blob) => Promise<void>;

/** A timestamp in office time on a given day. */
function at(day: string, hour = 9, minute = 0): string {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+03:00`;
}

// Invented people and clients. usr_001 to usr_008 in this order, then the agent as usr_009.
const PEOPLE: { name: string; admin?: boolean; discipline: string; gender: 'female' | 'male' }[] = [
  { name: 'Hala Nasser', admin: true, discipline: 'Architect', gender: 'female' },
  { name: 'Faisal Al-Harbi', discipline: 'Architect', gender: 'male' },
  { name: 'Reem Al-Ghamdi', discipline: 'Architect', gender: 'female' },
  { name: 'Omar Haddad', discipline: 'Structural', gender: 'male' },
  { name: 'Sara Al-Qahtani', discipline: 'Architect', gender: 'female' },
  { name: 'Yousef Saleh', discipline: 'MEP', gender: 'male' },
  { name: 'Lina Mansour', discipline: 'Interior', gender: 'female' },
  { name: 'Khalid Al-Mutairi', discipline: 'Structural', gender: 'male' },
];

// The two office roles of colleague comments 6 and 13. They come after the agent, so the ids of the first nine users stay as they were.
const OFFICE_ROLES: { name: string; role: 'management' | 'accounting'; discipline: string; gender: 'female' | 'male' }[] = [
  { name: 'Turki Al-Otaibi', role: 'management', discipline: 'Management', gender: 'male' },
  { name: 'Noura Al-Shammari', role: 'accounting', discipline: 'Accounting', gender: 'female' },
];

export function sampleEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@madar.test`;
}

/** The sample people's grammatical gender by email, for offices saved before the field existed. */
export const SAMPLE_GENDERS: Record<string, 'female' | 'male'> = Object.fromEntries([...PEOPLE, ...OFFICE_ROLES].map((person) => [sampleEmail(person.name), person.gender]));

// English name, contact, Arabic name (colleague comment 11).
const CLIENTS: [string, string, string][] = [
  ['Gulf Crest Holding', 'Nawaf Al-Shehri', 'شركة قمة الخليج القابضة'],
  ['Dune Line Developments', 'Maha Al-Dosari', 'شركة خط الكثبان للتطوير'],
  ['Eastern Shore Schools Co.', 'Tariq Al-Anazi', 'شركة مدارس الساحل الشرقي'],
  ['Nakhla Retail Group', 'Dana Al-Omari', 'مجموعة نخلة للتجزئة'],
  ['Tamr Hospitality', 'Bader Al-Zahrani', 'تمر للضيافة'],
  ['Al Waha Healthcare', 'Rana Al-Subaie', 'الواحة للرعاية الصحية'],
];

type Shape = 'late' | 'risk_overdue' | 'risk_stage' | 'on_track' | 'on_hold' | 'completed';
type Plan = {
  code: string; name: string; client: number; shape: Shape; stage: number; leader: number; team: number[];
  area: number; location: string; cover: boolean; hue: number;
  /** For a paused project: when the leader paused it (days ago), why, and who it waits for (colleague comment 16). */
  pause?: { daysAgo: number; kind: 'internal' | 'client'; reason: string };
};

// "leader" and "team" are indexes into PEOPLE. "stage" is an index into the default stage list.
const PLANS: Plan[] = [
  { code: 'KH-26-001', name: 'Corniche Office Tower', client: 0, shape: 'late', stage: 3, leader: 1, team: [4, 5, 7], area: 24500, location: 'Al Khobar, Corniche', cover: true, hue: 210 },
  { code: 'KH-26-002', name: 'Dune Line Townhouses', client: 1, shape: 'risk_overdue', stage: 2, leader: 2, team: [4, 6], area: 9800, location: 'Al Khobar, Al Rakah', cover: true, hue: 28 },
  { code: 'KH-26-003', name: 'Eastern Shore Primary School', client: 2, shape: 'on_track', stage: 1, leader: 3, team: [5, 7], area: 6200, location: 'Dhahran, Al Doha', cover: true, hue: 150 },
  { code: 'KH-26-004', name: 'Nakhla Mall Extension', client: 3, shape: 'risk_stage', stage: 3, leader: 1, team: [4, 5, 6, 7], area: 31000, location: 'Dammam, King Fahd Road', cover: true, hue: 265 },
  { code: 'KH-26-005', name: 'Tamr Boutique Hotel', client: 4, shape: 'on_track', stage: 0, leader: 2, team: [6], area: 7400, location: 'Al Khobar, Al Olaya', cover: false, hue: 12 },
  { code: 'KH-26-006', name: 'Al Waha Clinic Fit-out', client: 5, shape: 'late', stage: 4, leader: 0, team: [5, 6], area: 1800, location: 'Al Khobar, Al Aqrabiyah', cover: true, hue: 190 },
  { code: 'KH-26-007', name: 'Seaside Villa Compound', client: 1, shape: 'risk_overdue', stage: 2, leader: 3, team: [4, 7], area: 14200, location: 'Al Khobar, Half Moon Bay', cover: true, hue: 45 },
  { code: 'KH-26-008', name: 'Rakah Neighbourhood Mosque', client: 2, shape: 'on_track', stage: 5, leader: 2, team: [5, 7], area: 1200, location: 'Al Khobar, Al Rakah', cover: false, hue: 120 },
  { code: 'KH-25-014', name: 'Gulf Crest HQ Interiors', client: 0, shape: 'on_hold', stage: 2, leader: 1, team: [6], area: 3600, location: 'Al Khobar, Prince Turki Street', cover: true, hue: 300,
    pause: { daysAgo: 12, kind: 'client', reason: 'Waiting for the client to approve the revised fit-out brief.' } },
  { code: 'KH-25-009', name: 'Dune Line Show Villa', client: 1, shape: 'completed', stage: 6, leader: 3, team: [4], area: 650, location: 'Al Khobar, Al Rakah', cover: true, hue: 80 },
  { code: 'KH-26-009', name: 'Shore Walk Retail Kiosks', client: 3, shape: 'on_track', stage: 6, leader: 1, team: [5, 7], area: 900, location: 'Al Khobar, Corniche', cover: false, hue: 170 },
  { code: 'KH-26-010', name: 'Tamr Staff Housing', client: 4, shape: 'on_hold', stage: 1, leader: 2, team: [4, 6], area: 5200, location: 'Dammam, Al Faisaliyah', cover: true, hue: 340,
    pause: { daysAgo: 45, kind: 'internal', reason: 'The office waits for the land title to be settled before it designs further.' } },
];

// The current stage window, in days from today. These windows make the health mix come out the same every day.
const WINDOW: Record<Shape, [number, number]> = {
  late: [-60, -3], risk_overdue: [-20, 30], risk_stage: [-40, 5], on_track: [-10, 35], on_hold: [-90, -30], completed: [-120, -20],
};
const PAST_STAGE_DAYS = 28;
const FUTURE_STAGE_DAYS = 35;

const TITLES: string[][] = [
  ['Site analysis', 'Massing options', 'Concept presentation', 'Area schedule', 'Client brief review', 'Precedent study', 'Zoning check', 'Concept sketches'],
  ['Floor plan options', 'Structural grid study', 'Facade concept', 'Client review pack', 'Parking layout', 'Core layout', 'Sun study', 'Cost plan input'],
  ['Ground floor plan', 'Typical floor plan', 'Wall sections', 'MEP coordination', 'Facade details', 'Material board', 'Roof plan', 'Landscape layout'],
  ['Door and window schedule', 'Reflected ceiling plans', 'Stair details', 'Structural drawings check', 'Specifications draft', 'Toilet details', 'Finishes schedule', 'Section set'],
  ['Balady submission set', 'Civil Defense drawings', 'Authority comments response', 'Permit fee receipt', 'Fire strategy report', 'Accessibility check', 'Utility approvals', 'Permit tracker update'],
  ['BOQ review', 'Tender drawings issue', 'Bidder questions log', 'Tender evaluation', 'Addendum 1', 'Tender clarifications', 'Contractor shortlist', 'Award memo'],
  ['Site visit report', 'Shop drawing review', 'RFI responses', 'Snag list', 'Material approvals', 'Progress photos', 'Handover checklist', 'As-built review'],
];

const CURRENT_STATUSES: Record<Shape, Task['status'][]> = {
  late: ['done', 'done', 'in_progress', 'in_progress', 'todo', 'in_review'],
  risk_overdue: ['done', 'done', 'done', 'in_progress', 'todo', 'in_review'],
  risk_stage: ['done', 'done', 'in_progress', 'in_progress', 'todo', 'in_review'],
  on_track: ['done', 'done', 'done', 'in_progress', 'todo', 'todo'],
  on_hold: ['done', 'in_progress', 'todo', 'todo', 'todo', 'todo'],
  completed: ['done', 'done', 'done', 'done', 'done', 'done'],
};

// Due dates of the open current-stage tasks, in days from today, in the order they appear above.
/**
 * When an open task starts. Most start a few days before they are due. One in three is dynamic: its start is found by
 * counting working days back from the due date, so the sample due dates (and their words) stay as they are.
 * A task that is due on a weekend stays static. A done task has no start, like a task saved before start dates existed.
 */
function timingFor(n: number, due: string, today: string): Pick<Task, 'startDate' | 'schedule' | 'durationDays'> {
  const length = 3 + ((n * 2) % 6);
  if (n % 3 === 1 && isWorkingDay(due)) {
    let start = due;
    for (let left = length - 1; left > 0; ) {
      start = addDays(start, -1);
      if (isWorkingDay(start)) left -= 1;
    }
    return { startDate: start, schedule: 'dynamic', durationDays: length };
  }
  return { startDate: minDay(addDays(due, -length - 2), addDays(today, 3)), schedule: 'static', durationDays: null };
}

const OPEN_DUE: Record<Shape, number[]> = {
  late: [-5, 3, 7, -2],
  risk_overdue: [-4, 9, 2],
  risk_stage: [1, 3, 4, 2],
  on_track: [4, 12, 20],
  on_hold: [30, 34, 38, 42, 46],
  completed: [],
};

const FILES: { name: string; kind: 'svg' | 'pdf'; versions: number; daysAgo: number }[] = [
  { name: 'Cover render.svg', kind: 'svg', versions: 1, daysAgo: 18 },
  { name: 'Massing view.svg', kind: 'svg', versions: 1, daysAgo: 14 },
  { name: 'Ground floor plan.pdf', kind: 'pdf', versions: 2, daysAgo: 10 },
  { name: 'Site plan.pdf', kind: 'pdf', versions: 1, daysAgo: 7 },
  { name: 'Facade study.svg', kind: 'svg', versions: 1, daysAgo: 3 },
];

type SeedCtx = { state: State; today: string; humans: User[]; clientIds: string[]; saveBlob: (blob: Blob) => string };

function addProject(seed: SeedCtx, plan: Plan, index: number): void {
  const { state, today, humans, clientIds, saveBlob } = seed;
  const leader = humans[plan.leader];
  const team = plan.team.map((i) => humans[i]);
  const owners = [leader, ...team];
  const ec = (actor: User, stamp: string): EventContext => ({ state, actor, stamp, correlationId: `seed_${plan.code}` });
  const projectId = nextId(state, 'prj');
  const curStart = addDays(today, WINDOW[plan.shape][0]);
  const curEnd = addDays(today, WINDOW[plan.shape][1]);
  const names = state.settings.defaultStages;

  const stageIds = names.map((name, order) => {
    const id = nextId(state, 'stg');
    let startDate = curStart;
    let endDate = curEnd;
    if (order < plan.stage) {
      startDate = addDays(curStart, -(plan.stage - order) * PAST_STAGE_DAYS);
      endDate = addDays(startDate, PAST_STAGE_DAYS - 1);
    } else if (order > plan.stage) {
      startDate = addDays(curEnd, 1 + (order - plan.stage - 1) * FUTURE_STAGE_DAYS);
      endDate = addDays(startDate, FUTURE_STAGE_DAYS - 1);
    }
    state.stages[id] = { id, projectId, name, order, startDate, endDate };
    return id;
  });
  const firstStart = state.stages[stageIds[0]].startDate ?? curStart;
  const lastEnd = state.stages[stageIds[stageIds.length - 1]].endDate ?? curEnd;
  const created = at(firstStart);
  const status = plan.shape === 'on_hold' ? 'on_hold' : plan.shape === 'completed' ? 'completed' : 'active';
  const project: Project = {
    id: projectId, code: plan.code, name: plan.name, clientId: clientIds[plan.client], status, leaderId: leader.id,
    currentStageId: stageIds[plan.stage], location: plan.location, areaM2: plan.area, startDate: firstStart, targetEndDate: lastEnd,
    coverFileId: null, modelFolderPath: `\\\\STUDIO\\Projects\\${plan.code}`, description: `${plan.name} for ${CLIENTS[plan.client][0]}.`,
    healthOverride: null, mark: pickMark(projectId, Object.values(state.projects)), createdBy: leader.id, createdAt: created, updatedAt: created,
    ...(plan.pause ? { pause: { reason: plan.pause.reason, resumeOn: null, by: leader.id, at: at(addDays(today, -plan.pause.daysAgo), 9), kind: plan.pause.kind } } : {}),
  };
  state.projects[projectId] = project;

  // Agents are never members: the assistant reaches what its person, the Admin, reaches (spec 17).
  const memberIds = new Set([leader.id, ...team.map((u) => u.id)]);
  for (const userId of memberIds) {
    state.members[memberKey(projectId, userId)] = { projectId, userId, discipline: state.users[userId].discipline };
  }
  addProjectConversation(state, projectId, created);
  writeEvent(ec(leader, created), { projectId, verb: 'project.created', targetType: 'project', targetId: projectId, before: null, after: { ...project } });
  if (plan.stage > 0) {
    writeEvent(ec(leader, at(curStart, 10)), {
      projectId, verb: 'project.stage_changed', targetType: 'project', targetId: projectId,
      before: { currentStageId: stageIds[plan.stage - 1] }, after: { currentStageId: stageIds[plan.stage] },
    });
  }

  const addTask = (stageIndex: number, n: number, taskStatus: Task['status'], createdDay: string, due: string | null, title?: string): Task => {
    const id = nextId(state, 'tsk');
    const owner = owners[(n + index) % owners.length];
    const createdAt = at(createdDay, 9, (n * 7) % 60);
    const doneDay = maxDay(createdDay, minDay(addDays(createdDay, 5), addDays(today, -1)));
    const completedAt = taskStatus === 'done' ? at(doneDay, 14) : null;
    const task: Task = {
      id, projectId, stageId: stageIds[stageIndex], title: title ?? TITLES[stageIndex][(n + index) % TITLES[stageIndex].length],
      description: '', ownerId: owner.id, status: taskStatus, dueDate: due, ...(taskStatus !== 'done' && due ? timingFor(n, due, today) : {}), flagged: n === 3 && index % 2 === 0, needsReview: n % 3 !== 2,
      checklist: n === 1
        ? [{ id: 'c1', text: 'Check the dimensions', done: taskStatus === 'done' }, { id: 'c2', text: 'Coordinate with structure', done: false }]
        : [],
      createdBy: leader.id, createdAt, completedAt,
    };
    state.tasks[id] = task;
    writeEvent(ec(leader, createdAt), { projectId, verb: 'task.created', targetType: 'task', targetId: id, before: null, after: { ...task, status: 'todo', completedAt: null } });
    if (completedAt) {
      writeEvent(ec(owner, completedAt), {
        projectId, verb: 'task.status_changed', targetType: 'task', targetId: id,
        before: { status: 'in_progress', completedAt: null }, after: { status: 'done', completedAt },
      });
    }
    if (taskStatus === 'in_review') {
      const stamp = at(maxDay(createdDay, minDay(addDays(createdDay, 3), addDays(today, -1))), 11);
      writeEvent(ec(owner, stamp), { projectId, verb: 'task.status_changed', targetType: 'task', targetId: id, before: { status: 'in_progress' }, after: { status: 'in_review' } });
      notify(state, owner, stamp, { userIds: reviewersOf(state, projectId), trigger: 'review_requested', targetType: 'task', targetId: id });
    }
    return task;
  };

  // Two done tasks in each of the last two past stages.
  for (let s = Math.max(0, plan.stage - 2); s < plan.stage; s += 1) {
    const start = state.stages[stageIds[s]].startDate ?? curStart;
    for (let n = 0; n < 2; n += 1) addTask(s, n, 'done', addDays(start, 2 + n * 6), addDays(start, 10 + n * 6));
  }
  // Six tasks in the current stage, shaped by the health the project must show.
  let open = 0;
  CURRENT_STATUSES[plan.shape].forEach((taskStatus, n) => {
    const createdDay = minDay(addDays(curStart, 1 + n * 2), today);
    const due = taskStatus === 'done' ? addDays(createdDay, 7) : addDays(today, OPEN_DUE[plan.shape][open++]);
    addTask(plan.stage, n, taskStatus, createdDay, due);
  });
  // Two tasks ready in the next stage.
  const closing = plan.shape === 'completed';
  if (plan.stage < stageIds.length - 1 && !closing) {
    const nextStart = state.stages[stageIds[plan.stage + 1]].startDate ?? curEnd;
    for (let n = 0; n < 2; n += 1) addTask(plan.stage + 1, n, 'todo', addDays(today, -3 + n), addDays(nextStart, 10 + n * 10));
  }
  addTask(plan.stage, 6, closing ? 'done' : 'todo', minDay(addDays(curStart, 3), today), closing ? addDays(curStart, 10) : addDays(today, 14), 'Coordination meeting notes');

  const deadlines: [string, string][] = closing
    ? [['Handover', curEnd]]
    : [['Client presentation', addDays(curEnd, -2)], ['Stage submission', curEnd], ['Coordination workshop', addDays(today, 5 + (index % 7))]];
  if (plan.stage === 3 && !closing) deadlines.push(['Balady submission', addDays(curEnd, 10)]);
  for (const [name, date] of deadlines) {
    const id = nextId(state, 'ddl');
    state.deadlines[id] = { id, projectId, stageId: stageIds[plan.stage], name, date };
  }

  FILES.forEach((spec, n) => {
    const id = nextId(state, 'fil');
    const name = n === 0 && !plan.cover ? 'Street view.svg' : spec.name;
    const title = name.replace(/\.(svg|pdf)$/, '');
    const versions: FileVersion[] = Array.from({ length: spec.versions }, (_, v) => {
      const letter = String.fromCharCode(65 + v);
      const blob = spec.kind === 'svg'
        ? new Blob([renderSvg(plan.name, `${plan.code} · ${title}`, plan.hue, n)], { type: 'image/svg+xml' })
        : new Blob([drawingPdf([`${plan.code} ${plan.name}`, title, `Revision ${letter}`])], { type: 'application/pdf' });
      return {
        letter, blobKey: saveBlob(blob), mimeType: blob.type, size: blob.size, uploadedBy: owners[(n + v) % owners.length].id,
        uploadedAt: at(addDays(today, -spec.daysAgo + v * 4), 12, n * 5),
      };
    });
    const file: FileRec = { id, projectId, stageId: stageIds[plan.stage], taskId: null, name, versions };
    state.files[id] = file;
    writeEvent(ec(state.users[versions[0].uploadedBy], versions[0].uploadedAt), {
      projectId, verb: 'file.added', targetType: 'file', targetId: id, before: null, after: { ...file, versions: [versions[0]] },
    });
    if (versions.length > 1) {
      writeEvent(ec(state.users[versions[1].uploadedBy], versions[1].uploadedAt), {
        projectId, verb: 'file.version_added', targetType: 'file', targetId: id, before: { versions: [versions[0]] }, after: { versions },
      });
    }
    if (n === 0 && plan.cover) project.coverFileId = id;
  });

  const mate = team[0] ?? leader;
  const kickoffAt = at(maxDay(curStart, addDays(today, -12)), 8, 30);
  const kickoffId = nextId(state, 'upd');
  state.updates[kickoffId] = {
    id: kickoffId, projectId, authorId: leader.id, fileIds: [], createdAt: kickoffAt, editedAt: null,
    body: `Kick-off notes for ${names[plan.stage]}: the scope is agreed with the client. ${mentionMarkup(mate.name, mate.id)} please start on the ${TITLES[plan.stage][index % 8].toLowerCase()}.`,
  };
  notify(state, leader, kickoffAt, { userIds: [mate.id], trigger: 'mention', targetType: 'update', targetId: kickoffId });
  const drawing = Object.values(state.files).find((f) => f.projectId === projectId && f.name === 'Ground floor plan.pdf');
  const noteId = nextId(state, 'upd');
  const noteAt = at(addDays(today, -2), 16);
  state.updates[noteId] = {
    id: noteId, projectId, authorId: mate.id, body: `${mentionMarkup(leader.name, leader.id)} I uploaded revision B of the ground floor plan for review.`,
    fileIds: drawing ? [drawing.id] : [], createdAt: noteAt, editedAt: null,
  };
  notify(state, mate, noteAt, { userIds: [leader.id], trigger: 'mention', targetType: 'update', targetId: noteId });

  const discussed = Object.values(state.tasks)
    .filter((t) => t.projectId === projectId && (t.status === 'in_review' || t.status === 'in_progress'))
    .slice(0, 2);
  for (const task of discussed) {
    const askId = nextId(state, 'cmt');
    state.comments[askId] = {
      id: askId, targetType: 'task', targetId: task.id, authorId: leader.id, body: 'Please check the dimensions against the latest survey before Thursday.',
      reactions: { ...emptyReactions(), '👍': [task.ownerId] }, createdAt: at(addDays(today, -1), 10), editedAt: null,
    };
    const replyId = nextId(state, 'cmt');
    state.comments[replyId] = {
      id: replyId, targetType: 'task', targetId: task.id, authorId: task.ownerId, body: 'Done. I updated the sheet.',
      reactions: emptyReactions(), createdAt: at(addDays(today, -1), 14), editedAt: null,
    };
  }
}

function addAgentSummaries(state: State, today: string, agentId: string): void {
  for (const project of Object.values(state.projects)) {
    if (project.status !== 'active') continue;
    const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
    for (let k = 3; k >= 0; k -= 1) {
      const sunday = addDays(weekStartOf(today), -7 * k);
      const open = tasks.filter((t) => t.status !== 'done').length;
      const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < sunday && (t.status === 'todo' || t.status === 'in_progress')).length;
      const next = Object.values(state.deadlines)
        .filter((d) => d.projectId === project.id && d.date >= sunday)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      const days = next ? diffDays(sunday, next.date) : 0;
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      const tail = next ? ` Next deadline: ${next.name}, ${when}.` : '';
      const id = nextId(state, 'upd');
      state.updates[id] = {
        id, projectId: project.id, authorId: agentId, body: `Weekly summary: ${open} open tasks, ${overdue} overdue.${tail}`,
        fileIds: [], createdAt: at(sunday, 8), editedAt: null,
      };
    }
  }
}

type Talk = { by: number; days: number; hour: number; minute: number; text: string };

/** Sample chat. "by" is an index into PEOPLE. Days count back from today. The Admin keeps a few messages unread. */
function addChatTalk(state: State, today: string, humans: User[]): void {
  const who = (index: number) => humans[index];
  const tag = (index: number) => mentionMarkup(who(index).name, who(index).id);
  const project = (code: string) => Object.values(state.projects).find((p) => p.code === code);
  const post = (conversationId: string, talk: Talk[]): void => {
    for (const line of talk) {
      const id = nextId(state, 'msg');
      const author = who(line.by);
      const mentions = [...line.text.matchAll(/\((usr_\d{3,})\)/g)].map((m) => m[1]);
      state.messages[id] = {
        id, conversationId, authorId: author.id, actingForId: author.id, body: line.text, mentions,
        createdAt: at(addDays(today, -line.days), line.hour, line.minute), editedAt: null,
      };
    }
  };
  const lastOf = (conversationId: string): string =>
    Object.values(state.messages).filter((m) => m.conversationId === conversationId).map((m) => m.createdAt).sort().at(-1) ?? '';
  const read = (conversationId: string, userId: string, lastReadAt: string): void => {
    state.chatReads[chatReadKey(conversationId, userId)] = { conversationId, userId, lastReadAt };
  };
  const rooms: { id: string; people: string[] }[] = [];

  const talks: [string, Talk[]][] = [
    ['KH-26-001', [
      { by: 1, days: 1, hour: 9, minute: 10, text: 'Good morning team. The civil defense comments came back. We must fix the stair widths before Thursday.' },
      { by: 4, days: 1, hour: 9, minute: 40, text: 'I checked the plans. Stair 2 is 1.10 m wide. The code asks for 1.20 m.' },
      { by: 7, days: 1, hour: 10, minute: 5, text: `I can move the core wall by 100 mm. ${tag(4)} send me the section line when you are ready.` },
      { by: 4, days: 1, hour: 10, minute: 20, text: 'Done. I put the new section on the shared sheet.' },
      { by: 5, days: 0, hour: 7, minute: 15, text: `The sprinkler riser clashes with beam B14. ${tag(1)} can we shift it 300 mm east?` },
      { by: 1, days: 0, hour: 7, minute: 50, text: 'Yes, go ahead. Update the MEP model and tell Khalid.' },
    ]],
    ['KH-26-002', [
      { by: 2, days: 1, hour: 14, minute: 0, text: 'The client wants the townhouse facade in light sand stone. I will send the sample photos today.' },
      { by: 6, days: 1, hour: 14, minute: 30, text: 'I prepared two interior palettes. Both work with the sand stone.' },
      { by: 4, days: 0, hour: 6, minute: 55, text: 'The front garden wall was 40 cm too long on the site plan. I fixed it in revision C.' },
      { by: 2, days: 0, hour: 7, minute: 30, text: `Thanks Sara. ${tag(6)} please check the garden lights against the new wall.` },
    ]],
    ['KH-26-006', [
      { by: 0, days: 2, hour: 11, minute: 0, text: 'The health authority visits next week. We need the clinic room schedule final by Monday.' },
      { by: 5, days: 2, hour: 11, minute: 20, text: 'The air handling unit schedule is ready. I wait for the room list.' },
      { by: 6, days: 1, hour: 13, minute: 0, text: 'The room list is ready. I put the finish codes in column F.' },
    ]],
  ];
  for (const [code, talk] of talks) {
    const target = project(code);
    const room = target && Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === target.id);
    if (!target || !room) continue;
    post(room.id, talk);
    rooms.push({ id: room.id, people: [...new Set([target.leaderId ?? '', ...Object.values(state.members).filter((m) => m.projectId === target.id).map((m) => m.userId)])] });
  }

  const direct: [number, number, Talk[]][] = [
    [0, 1, [
      { by: 1, days: 1, hour: 17, minute: 0, text: 'Hala, do you have ten minutes tomorrow about the tower schedule?' },
      { by: 0, days: 1, hour: 17, minute: 12, text: 'Yes. Come to my desk at 10.' },
      { by: 1, days: 0, hour: 7, minute: 40, text: 'I will bring the new stage dates.' },
    ]],
    [0, 2, [
      { by: 2, days: 2, hour: 15, minute: 0, text: 'The client approved the townhouse massing.' },
      { by: 0, days: 2, hour: 15, minute: 5, text: 'Good news. Please tell the team and update the stage.' },
    ]],
  ];
  const unreadFor = humans[0].id;
  for (const [a, b, talk] of direct) {
    const room = addDirectConversation(state, who(a).id, who(b).id, at(addDays(today, -talk[0].days), talk[0].hour));
    post(room.id, talk);
    rooms.push({ id: room.id, people: [who(a).id, who(b).id] });
  }

  for (const room of rooms) {
    for (const userId of room.people) read(room.id, userId, lastOf(room.id));
    // The Admin reads every room, except two that keep unread messages for the demo.
    read(room.id, unreadFor, lastOf(room.id));
  }
  const tower = project('KH-26-001');
  const towerRoom = tower && Object.values(state.conversations).find((c) => c.projectId === tower.id);
  if (towerRoom) read(towerRoom.id, unreadFor, at(addDays(today, -1), 11, 0));
  const withFaisal = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes(who(0).id) && c.memberIds.includes(who(1).id));
  if (withFaisal) read(withFaisal.id, unreadFor, at(addDays(today, -1), 17, 12));
}

/** Builds the sample office. Every date comes from "today", so the data is fresh on any day. */
/** A few links to places outside Madar, so the About panel shows what the list looks like (colleague comment 5). */
function addSampleLinks(state: State) {
  const links: Record<string, [LinkKind, string, string][]> = {
    prj_001: [
      ['moodboard', 'Pinterest: facades', 'https://www.pinterest.com/madar-studio/corniche-facades/'],
      ['location', 'Google Maps', 'https://maps.google.com/?q=26.2928,50.2172'],
      ['delivery', 'Google Drive: deliveries', 'https://drive.google.com/drive/folders/corniche-client-deliveries'],
    ],
    prj_002: [
      ['moodboard', 'Pinterest: courtyards', 'https://www.pinterest.com/madar-studio/dune-line-courtyards/'],
      ['location', 'Google Maps', 'https://maps.google.com/?q=26.3412,50.1951'],
    ],
    prj_003: [['location', 'Google Maps', 'https://maps.google.com/?q=26.3069,50.1453']],
  };
  for (const [projectId, rows] of Object.entries(links)) {
    const project = state.projects[projectId];
    if (!project) continue;
    project.links = rows.map(([kind, label, url]) => ({ id: nextId(state, 'lnk'), kind, label, url }));
  }
}

type TrackerPlan = {
  /** The entry that a client pause logs. The pause points to it, so Resume closes it. */
  pause?: true;
  daysAgo: number; type: TrackerEntry['type']; direction: TrackerEntry['direction']; title: string; note?: string;
  waiting?: TrackerEntry['waiting']; closedDaysAgo?: number; file?: string; auto?: TrackerEntry['auto']; by: number; people?: number[];
};

// The client record of three projects. "by" and "people" are indexes into PEOPLE. A question nobody answered is open on two of them.
const TRACKER: Record<string, TrackerPlan[]> = {
  'KH-26-001': [
    { daysAgo: 26, type: 'meeting', direction: 'in', title: 'Kick-off meeting at the client office', note: 'We agreed the scope and the dates of the reviews.', by: 1, people: [1, 4] },
    { daysAgo: 12, type: 'balady', direction: 'out', title: 'Submitted the building permit request on the Balady portal', note: 'Request number 4471.', by: 4 },
    { daysAgo: 9, type: 'message', direction: 'out', title: 'Asked the client to choose a facade option', waiting: 'client', closedDaysAgo: 4, by: 1 },
    { daysAgo: 7, type: 'file', direction: 'in', title: 'Site plan.pdf', note: 'Version A', file: 'Site plan.pdf', auto: 'upload', by: 5 },
    { daysAgo: 6, type: 'message', direction: 'out', title: 'Asked the client for the signed fee agreement', waiting: 'client', by: 1 },
    { daysAgo: 5, type: 'message', direction: 'in', title: 'The client asked to move the lobby entrance', note: 'Nawaf phoned the office. He wants the entrance on the Corniche side.', waiting: 'us', by: 4, people: [1] },
    { daysAgo: 3, type: 'file', direction: 'out', title: 'Ground floor plan.pdf', note: 'Version B', file: 'Ground floor plan.pdf', auto: 'delivered', by: 4 },
    { daysAgo: 2, type: 'balady', direction: 'in', title: 'Balady portal: the request moved to Review', by: 5 },
  ],
  'KH-25-014': [
    { pause: true, daysAgo: 12, type: 'message', direction: 'out', title: 'Waiting for the client to approve the revised fit-out brief.', waiting: 'client', by: 1 },
  ],
  'KH-26-002': [
    { daysAgo: 21, type: 'meeting', direction: 'in', title: 'Design review meeting with Maha Al-Dosari', note: 'She accepted the townhouse layout. She will send the colour choices.', by: 2, people: [2, 4] },
    { daysAgo: 14, type: 'message', direction: 'in', title: 'The client sent the colour choices by email', by: 6 },
    { daysAgo: 10, type: 'message', direction: 'out', title: 'Sent the updated floor plan options', by: 4 },
    { daysAgo: 7, type: 'file', direction: 'in', title: 'Site plan.pdf', note: 'Version A', file: 'Site plan.pdf', auto: 'upload', by: 4 },
    { daysAgo: 2, type: 'message', direction: 'in', title: 'The client asked if the roof terrace can be bigger', waiting: 'us', by: 2 },
  ],
  'KH-26-006': [
    { daysAgo: 30, type: 'meeting', direction: 'in', title: 'Site visit with Rana Al-Subaie', note: 'We measured the clinic floor and checked the old drawings.', by: 0, people: [0, 5, 6] },
    { daysAgo: 16, type: 'balady', direction: 'out', title: 'Submitted the fit-out permit request', by: 5 },
    { daysAgo: 9, type: 'balady', direction: 'in', title: 'Balady asked for the Civil Defense drawings', waiting: 'us', closedDaysAgo: 5, by: 5 },
    { daysAgo: 5, type: 'balady', direction: 'out', title: 'Sent the Civil Defense drawings to Balady', by: 5 },
    { daysAgo: 4, type: 'message', direction: 'out', title: 'Asked the client for the signed electrical load sheet', waiting: 'client', by: 0 },
    { daysAgo: 3, type: 'balady', direction: 'in', title: 'Balady portal: the permit status is now Under review', by: 6 },
  ],
};

function addTracker(state: State, today: string, humans: User[]): void {
  state.tracker = {};
  for (const [code, plans] of Object.entries(TRACKER)) {
    const project = Object.values(state.projects).find((p) => p.code === code);
    if (!project) continue;
    for (const plan of plans) {
      const id = nextId(state, 'trk');
      const day = addDays(today, -plan.daysAgo);
      const file = plan.file ? Object.values(state.files).find((f) => f.projectId === project.id && f.name === plan.file) : undefined;
      const closed = plan.closedDaysAgo !== undefined;
      state.tracker[id] = {
        id, projectId: project.id, type: plan.type, direction: plan.direction, title: plan.title, note: plan.note ?? '', date: day,
        waiting: plan.waiting ?? null, closedAt: closed ? at(addDays(today, -plan.closedDaysAgo!), 11) : null,
        closedBy: closed ? humans[plan.by].id : null, fileIds: file ? [file.id] : [], peopleIds: (plan.people ?? []).map((n) => humans[n].id),
        auto: plan.auto ?? null, createdBy: humans[plan.by].id, createdAt: at(day, 10, plan.daysAgo),
      };
      if (plan.pause && project.pause) project.pause.trackerId = id;
    }
  }
}

/**
 * Payment milestones and contract start dates (colleagues' comments 6 and 7). "due" is days from today, "received" is days ago.
 * One milestone is overdue (the Corniche tower stage 3 fee) and two fall due within a week (Townhouses and the clinic).
 */
const PAYMENTS: Record<string, { contractAgo: number; items: { name: string; amount: number; due: number; received?: number; note?: string }[] }> = {
  'KH-26-001': {
    contractAgo: 150,
    items: [
      { name: 'Concept stage fee', amount: 180000, due: -110, received: 104 },
      { name: 'Schematic design fee', amount: 240000, due: -55, received: 49 },
      { name: 'Design development fee', amount: 320000, due: -12, note: 'The client asked for a revised invoice.' },
      { name: 'Construction documents fee', amount: 360000, due: 40 },
    ],
  },
  'KH-26-002': {
    contractAgo: 120,
    items: [
      { name: 'Concept stage fee', amount: 95000, due: -70, received: 66 },
      { name: 'Schematic design fee', amount: 120000, due: 4 },
      { name: 'Design development fee', amount: 140000, due: 45 },
    ],
  },
  'KH-26-003': {
    contractAgo: 60,
    items: [
      { name: 'Advance payment', amount: 150000, due: -50, received: 48 },
      { name: 'Concept stage fee', amount: 110000, due: 25 },
    ],
  },
  'KH-26-006': {
    contractAgo: 90,
    items: [
      { name: 'Advance payment', amount: 45000, due: -80, received: 78 },
      { name: 'Permit submission fee', amount: 38000, due: 3 },
    ],
  },
  'KH-26-004': { contractAgo: 200, items: [] },
  'KH-26-008': { contractAgo: 75, items: [] },
};

function addPayments(state: State, today: string, accountant: User): void {
  state.payments = {};
  for (const [code, plan] of Object.entries(PAYMENTS)) {
    const project = Object.values(state.projects).find((p) => p.code === code);
    if (!project) continue;
    project.contractStartDate = addDays(today, -plan.contractAgo);
    for (const item of plan.items) {
      const id = nextId(state, 'pay');
      state.payments[id] = {
        id, projectId: project.id, name: item.name, amount: item.amount, dueDate: addDays(today, item.due),
        receivedOn: item.received === undefined ? null : addDays(today, -item.received), note: item.note ?? '',
        createdBy: accountant.id, createdAt: at(addDays(today, -plan.contractAgo + 1), 10),
      };
    }
  }
}

export async function buildSeed(today: string, putBlob: PutBlob): Promise<State> {
  const state = emptyState(today);
  const blobJobs: Promise<void>[] = [];
  const saveBlob = (blob: Blob): string => {
    const key = `blob_seed_${String(blobJobs.length + 1).padStart(3, '0')}`;
    blobJobs.push(putBlob(key, blob));
    return key;
  };

  const humans = PEOPLE.map((person) => {
    const id = nextId(state, 'usr');
    const user: User = {
      id, name: person.name, email: sampleEmail(person.name), avatarUrl: null, kind: 'human',
      systemRole: person.admin ? 'admin' : 'member', discipline: person.discipline, active: true, ownerId: null,
      preferences: defaultPreferences(), gender: person.gender,
    };
    state.users[id] = user;
    return user;
  });
  const agentId = nextId(state, 'usr');
  state.users[agentId] = {
    id: agentId, name: 'Madar Assistant', email: 'assistant@madar.test', avatarUrl: null, kind: 'agent', systemRole: 'member',
    discipline: 'Agent', active: true, ownerId: humans[0].id, preferences: defaultPreferences(),
  };
  const accountant = OFFICE_ROLES.map((person) => {
    const id = nextId(state, 'usr');
    const user: User = {
      id, name: person.name, email: sampleEmail(person.name), avatarUrl: null, kind: 'human', systemRole: person.role,
      discipline: person.discipline, active: true, ownerId: null, preferences: defaultPreferences(), gender: person.gender,
    };
    state.users[id] = user;
    return user;
  })[1];
  state.session.currentUserId = humans[0].id;

  // Four office teams, with some people in two of them (colleague comment 15). Indexes into PEOPLE.
  [['Design', [1, 2, 4, 6]], ['Technical', [3, 5, 7]], ['Interiors', [2, 6]], ['Site', [5, 7, 4]]].forEach(([name, members]) => {
    const id = nextId(state, 'tm');
    state.teams![id] = { id, name: name as string, memberIds: (members as number[]).map((i) => humans[i].id) };
  });

  const templateAuthor = humans[0];
  [['Interior fit-out', ['Concept', 'Design Development', 'Construction Documents', 'Permits', 'Supervision']],
    ['Competition entry', ['Brief', 'Concept', 'Presentation']]].forEach(([name, stages]) => {
    const id = nextId(state, 'stt');
    state.stageTemplates![id] = { id, name: name as string, stages: stages as string[], createdBy: templateAuthor.id, createdAt: at(addDays(today, -30), 0) };
  });

  const clientIds = CLIENTS.map(([name, contactName, nameAr], i) => {
    const id = nextId(state, 'cli');
    state.clients[id] = {
      id, name, nameAr, contactName, phone: `+966 13 864 ${1000 + i * 37}`,
      email: `${contactName.split(' ')[0].toLowerCase()}@${name.split(' ')[0].toLowerCase()}.test`,
    };
    return id;
  });

  const seed: SeedCtx = { state, today, humans, clientIds, saveBlob };
  PLANS.forEach((plan, index) => addProject(seed, plan, index));
  addAgentSummaries(state, today, agentId);
  addChatTalk(state, today, humans);
  addSampleLinks(state);
  addTracker(state, today, humans);
  addPayments(state, today, accountant);

  const weekAgo = at(addDays(today, -7), 0);
  for (const n of Object.values(state.notifications)) if (n.createdAt < weekAgo) n.read = true;
  await Promise.all(blobJobs);
  return state;
}
