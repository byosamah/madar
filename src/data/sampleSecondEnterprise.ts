import { SECOND_ENTERPRISE_EMAILS } from '../api/fakeDirectory';
import { addProjectConversation } from '../api/chatState';
import { defaultPreferences, type Project, type Task, type User } from '../api/contract/entities';
import { writeEvent, type EventContext } from '../api/events';
import { emptyState, memberKey, nextId, type State } from '../api/store';
import { addDays } from '../lib/dates';
import { pickMark } from '../lib/projectMark';

/**
 * The small office of the second fake enterprise (Madar enterprises, design 5.19): one Admin, two members, one client and one project with
 * three to-dos. All names are neutral. The prototype starts it in place of the VADO sample office, so a screen shows no VADO content.
 * The names of the enterprise come from the fake directory, so a company made on the platform page opens with its own name.
 */
export type SecondEnterpriseNames = { name: string; nameAr: string; codePrefix: string };

const OASIS: SecondEnterpriseNames = { name: 'Oasis Builders', nameAr: 'واحة للإنشاءات', codePrefix: 'OB' };

const PEOPLE: { name: string; nameAr: string; discipline: string; gender: 'female' | 'male'; admin?: boolean }[] = [
  { name: 'Layla Hassan', nameAr: 'ليلى حسن', discipline: 'Architect', gender: 'female', admin: true },
  { name: 'Nadia Farouk', nameAr: 'نادية فاروق', discipline: 'Architect', gender: 'female' },
  { name: 'Karim Younis', nameAr: 'كريم يونس', discipline: 'Structural', gender: 'male' },
];

export function buildSecondEnterprise(today: string, names: SecondEnterpriseNames = OASIS): State {
  const state = emptyState(today);
  state.settings = { ...state.settings, codePrefix: names.codePrefix, enterpriseName: names.name, enterpriseNameAr: names.nameAr };
  const [admin, member, engineer] = PEOPLE.map((person, index) => {
    const id = nextId(state, 'usr');
    const user: User = {
      id, name: person.name, nameAr: person.nameAr, email: SECOND_ENTERPRISE_EMAILS[index], avatarUrl: null, kind: 'human',
      systemRole: person.admin ? 'admin' : 'member', discipline: person.discipline, active: true, ownerId: null,
      preferences: defaultPreferences(), gender: person.gender,
    };
    user.preferences.theme = 'system';
    state.users[id] = user;
    return user;
  });
  state.session.currentUserId = admin.id;

  const clientId = nextId(state, 'cli');
  state.clients[clientId] = {
    id: clientId, name: 'Palm Grove Developments', nameAr: 'شركة بستان النخيل للتطوير', contactName: 'Samir Aziz', phone: '+966 11 555 0140', email: 'samir@palmgrove.test',
  };

  const stamp = (day: string, hour = 9) => `${day}T${String(hour).padStart(2, '0')}:00:00.000+03:00`;
  const created = stamp(addDays(today, -10));
  const ec = (actor: User, at: string): EventContext => ({ state, actor, stamp: at, correlationId: 'seed_second_enterprise' });
  const projectId = nextId(state, 'prj');
  const stageNames = state.settings.defaultStages.slice(0, 3);
  const stageIds = stageNames.map((name, order) => {
    const id = nextId(state, 'stg');
    state.stages[id] = { id, projectId, name, order, startDate: addDays(today, -10 + order * 14), endDate: addDays(today, 3 + order * 14) };
    return id;
  });
  const project: Project = {
    id: projectId, code: `${names.codePrefix}-${today.slice(2, 4)}-001`, name: 'Garden Villa', clientId, status: 'active', leaderId: member.id,
    currentStageId: stageIds[0], location: 'Riyadh', areaM2: 420, geo: null, startDate: addDays(today, -10), targetEndDate: addDays(today, 31),
    coverFileId: null, modelFolderPath: '', description: 'A family villa with a garden court.', healthOverride: null,
    mark: pickMark(projectId, Object.values(state.projects)), createdBy: member.id, createdAt: created, updatedAt: created,
  };
  state.projects[projectId] = project;
  for (const person of [member, engineer]) state.members[memberKey(projectId, person.id)] = { projectId, userId: person.id, discipline: person.discipline };
  addProjectConversation(state, projectId, created);
  writeEvent(ec(member, created), { projectId, verb: 'project.created', targetType: 'project', targetId: projectId, before: null, after: { ...project } });

  const todo = (title: string, owner: User, stageIndex: number, dueIn: number): void => {
    const id = nextId(state, 'tsk');
    const task: Task = {
      id, projectId, stageId: stageIds[stageIndex], title, description: '', ownerId: owner.id, status: 'todo', dueDate: addDays(today, dueIn),
      flagged: false, needsReview: false, checklist: [], createdBy: member.id, createdAt: created, completedAt: null,
    };
    state.tasks[id] = task;
    writeEvent(ec(member, created), { projectId, verb: 'task.created', targetType: 'task', targetId: id, before: null, after: { ...task } });
  };
  todo('Measure the plot', engineer, 0, 2);
  todo('Draw the first concept plan', member, 0, 6);
  todo('Check the soil report', engineer, 1, 12);
  return state;
}
