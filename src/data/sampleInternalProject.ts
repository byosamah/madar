import { addProjectConversation } from '../api/chatState';
import type { Project, Task, User } from '../api/contract/entities';
import { writeEvent, type EventContext } from '../api/events';
import { memberKey, nextId, type State } from '../api/store';
import { addDays } from '../lib/dates';
import { INTERNAL_PREFIX } from '../lib/projectCode';
import { pickMark } from '../lib/projectMark';

/**
 * The sample internal project (fbk_044, owner 2026-10-22): "Portfolio 2026", hidden from the office, with a leader, one team member, two
 * stages and three to-dos. The prototype adds it on its first start and on "Reset sample data" (bootstrap.ts, sampleOffice.ts), so the
 * screens show the lock mark, the word Internal and the Team tab block. buildSeed does not add it: the screen tests count the projects of
 * the plain sample office. A saved office keeps what it had (no STATE_VERSION step).
 * To see it as a person, open the Projects list as the Admin, the leader (Reem Al-Ghamdi) or the team member (Lina Mansour).
 */
export function addSampleInternalProject(state: State, today: string): void {
  const humans = Object.values(state.users).filter((user) => user.kind === 'human' && user.active);
  const admin = humans.find((user) => user.systemRole === 'admin');
  const others = humans.filter((user) => user.systemRole !== 'admin');
  const leader: User | undefined = others.find((user) => user.name === 'Reem Al-Ghamdi') ?? others[0];
  const member: User | undefined = others.find((user) => user.name === 'Lina Mansour') ?? others.find((user) => user.id !== leader?.id);
  if (!admin || !leader || !member) return;
  const stamp = (day: string, hour = 9) => `${day}T${String(hour).padStart(2, '0')}:00:00.000+03:00`;
  const created = stamp(addDays(today, -14));
  const ec = (actor: User, at: string): EventContext => ({ state, actor, stamp: at, correlationId: 'seed_internal' });

  const id = nextId(state, 'prj');
  const code = `${INTERNAL_PREFIX}-${today.slice(2, 4)}-001`;
  const stageIds = [
    { name: 'Choose the work', startDate: addDays(today, -14), endDate: addDays(today, 13) },
    { name: 'Lay out the book', startDate: addDays(today, 14), endDate: addDays(today, 44) },
  ].map((stage, order) => {
    const stageId = nextId(state, 'stg');
    state.stages[stageId] = { id: stageId, projectId: id, order, ...stage };
    return stageId;
  });
  const project: Project = {
    id, code, name: 'Portfolio 2026', clientId: null, status: 'active', leaderId: leader.id, currentStageId: stageIds[0], location: '', areaM2: null,
    geo: null, startDate: addDays(today, -14), targetEndDate: addDays(today, 44), coverFileId: null, modelFolderPath: '',
    description: 'Our best work of the year, in one book for new clients.', healthOverride: null, mark: pickMark(id, Object.values(state.projects)),
    kind: 'internal', access: { hidden: true, viewerIds: [] }, createdBy: leader.id, createdAt: created, updatedAt: created,
  };
  state.projects[id] = project;
  for (const person of [leader, member]) state.members[memberKey(id, person.id)] = { projectId: id, userId: person.id, discipline: person.discipline };
  addProjectConversation(state, id, created);
  writeEvent(ec(leader, created), { projectId: id, verb: 'project.created', targetType: 'project', targetId: id, before: null, after: { ...project } });

  const todo = (title: string, owner: User, stageIndex: number, dueIn: number): void => {
    const taskId = nextId(state, 'tsk');
    const task: Task = {
      id: taskId, projectId: id, stageId: stageIds[stageIndex], title, description: '', ownerId: owner.id, status: 'todo',
      dueDate: addDays(today, dueIn), flagged: false, needsReview: false, checklist: [], createdBy: leader.id, createdAt: created, completedAt: null,
    };
    state.tasks[taskId] = task;
    writeEvent(ec(leader, created), { projectId: id, verb: 'task.created', targetType: 'task', targetId: taskId, before: null, after: { ...task } });
  };
  todo('Pick six projects for the book', leader, 0, 4);
  todo('Photograph the finished villa', member, 0, 9);
  todo('Draw the cover page', member, 1, 20);
}
