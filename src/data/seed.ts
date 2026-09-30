import { emptyState, memberKey, nextId, type State } from '../api/store';
import {
  defaultPreferences, emptyReactions, type FileRec, type FileVersion, type Project, type Task, type User,
} from '../api/contract/entities';
import { writeEvent, type EventContext } from '../api/events';
import { notify, reviewersOf } from '../api/notify';
import { addDays, dayOfWeek, diffDays, maxDay, minDay, weekStartOf } from '../lib/dates';
import { mentionMarkup } from '../lib/text';
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

const CLIENTS: [string, string][] = [
  ['Gulf Crest Holding', 'Nawaf Al-Shehri'],
  ['Dune Line Developments', 'Maha Al-Dosari'],
  ['Eastern Shore Schools Co.', 'Tariq Al-Anazi'],
  ['Nakhla Retail Group', 'Dana Al-Omari'],
  ['Tamr Hospitality', 'Bader Al-Zahrani'],
  ['Al Waha Healthcare', 'Rana Al-Subaie'],
];

type Shape = 'late' | 'risk_overdue' | 'risk_stage' | 'on_track' | 'on_hold' | 'completed';
type Plan = {
  code: string; name: string; client: number; shape: Shape; stage: number; leader: number; team: number[];
  area: number; location: string; cover: boolean; hue: number;
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
  { code: 'KH-25-014', name: 'Gulf Crest HQ Interiors', client: 0, shape: 'on_hold', stage: 2, leader: 1, team: [6], area: 3600, location: 'Al Khobar, Prince Turki Street', cover: true, hue: 300 },
  { code: 'KH-25-009', name: 'Dune Line Show Villa', client: 1, shape: 'completed', stage: 6, leader: 3, team: [4], area: 650, location: 'Al Khobar, Al Rakah', cover: true, hue: 80 },
  { code: 'KH-26-009', name: 'Shore Walk Retail Kiosks', client: 3, shape: 'on_track', stage: 6, leader: 1, team: [5, 7], area: 900, location: 'Al Khobar, Corniche', cover: false, hue: 170 },
  { code: 'KH-26-010', name: 'Tamr Staff Housing', client: 4, shape: 'on_track', stage: 1, leader: 2, team: [4, 6], area: 5200, location: 'Dammam, Al Faisaliyah', cover: true, hue: 340 },
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
    healthOverride: null, createdBy: leader.id, createdAt: created, updatedAt: created,
  };
  state.projects[projectId] = project;

  // Agents are never members: the assistant reaches what its person, the Admin, reaches (spec 17).
  const memberIds = new Set([leader.id, ...team.map((u) => u.id)]);
  for (const userId of memberIds) {
    state.members[memberKey(projectId, userId)] = { projectId, userId, discipline: state.users[userId].discipline };
  }
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
      description: '', ownerId: owner.id, status: taskStatus, dueDate: due, flagged: n === 3 && index % 2 === 0, needsReview: n % 3 !== 2,
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

function addTimeEntries(state: State, today: string, humans: User[]): void {
  const firstWeek = addDays(weekStartOf(today), -49);
  const lastWeek = addDays(weekStartOf(today), -7);
  humans.forEach((user, u) => {
    const projects = Object.values(state.projects).filter((p) => p.status === 'active' && state.members[memberKey(p.id, user.id)]);
    if (projects.length === 0) return;
    for (let day = firstWeek; day <= today; day = addDays(day, 1)) {
      if (dayOfWeek(day) > 4) continue;
      // Sara and Lina stay under target last week, so the Thursday reminder has something to show.
      const total = weekStartOf(day) === lastWeek && (u === 4 || u === 6) ? 6 : 8;
      const split = projects.length > 1 ? [total - 3.5, 3.5] : [total];
      const d = diffDays(firstWeek, day);
      split.forEach((hours, i) => {
        const project = projects[(d + u + i) % projects.length];
        const id = nextId(state, 'tim');
        state.time[id] = { id, userId: user.id, projectId: project.id, stageId: project.currentStageId, taskId: null, date: day, hours };
      });
    }
  });
}

/** Builds the sample office. Every date comes from "today", so the data is fresh on any day. */
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
      id, name: person.name, email: `${person.name.toLowerCase().replace(/[^a-z]+/g, '.')}@madar.test`, avatarUrl: null, kind: 'human',
      systemRole: person.admin ? 'admin' : 'member', discipline: person.discipline, weeklyHourTarget: 40, active: true, ownerId: null,
      preferences: defaultPreferences(), gender: person.gender,
    };
    state.users[id] = user;
    return user;
  });
  const agentId = nextId(state, 'usr');
  state.users[agentId] = {
    id: agentId, name: 'Madar Assistant', email: 'assistant@madar.test', avatarUrl: null, kind: 'agent', systemRole: 'member',
    discipline: 'Agent', weeklyHourTarget: 0, active: true, ownerId: humans[0].id, preferences: defaultPreferences(),
  };
  state.session.currentUserId = humans[0].id;

  const clientIds = CLIENTS.map(([name, contactName], i) => {
    const id = nextId(state, 'cli');
    state.clients[id] = {
      id, name, contactName, phone: `+966 13 864 ${1000 + i * 37}`,
      email: `${contactName.split(' ')[0].toLowerCase()}@${name.split(' ')[0].toLowerCase()}.test`,
    };
    return id;
  });

  const seed: SeedCtx = { state, today, humans, clientIds, saveBlob };
  PLANS.forEach((plan, index) => addProject(seed, plan, index));
  addAgentSummaries(state, today, agentId);
  addTimeEntries(state, today, humans);

  const weekAgo = at(addDays(today, -7), 0);
  for (const n of Object.values(state.notifications)) if (n.createdAt < weekAgo) n.read = true;
  await Promise.all(blobJobs);
  return state;
}
