import { EventTarget } from './contract/entities';
import type { State } from './store';

/**
 * Every field of a stored record that can hold the id of another record (plan 4.13, A1; AM 7.1).
 * The Undo of a create asks this map whether another record still uses the target. The prototype reads the fields in memory.
 * The server turns each entry into one EXISTS query with jsonPathOf(), so it never loads the whole office for the answer.
 *
 * A path names fields with dots. "name[]" walks each item of a list. "*" walks each value of a record (for example the reactions).
 * Events, notifications, the session, the settings and the counters are left out, as the scan before this map left them out.
 */
export type RefCollection = Exclude<keyof State, 'version' | 'seededOn' | 'session' | 'settings' | 'counters' | 'counts' | 'events' | 'notifications'>;
export type ReferenceField = { collection: RefCollection; path: string; targets: readonly EventTarget[] };
export type Reference = { collection: RefCollection; path: string };

export const REFERENCE_FIELDS: readonly ReferenceField[] = [
  { collection: 'users', path: 'ownerId', targets: ['user'] },

  { collection: 'projects', path: 'clientId', targets: ['client'] },
  { collection: 'projects', path: 'leaderId', targets: ['user'] },
  { collection: 'projects', path: 'currentStageId', targets: ['stage'] },
  { collection: 'projects', path: 'coverFileId', targets: ['file'] },
  { collection: 'projects', path: 'healthOverride.setBy', targets: ['user'] },
  { collection: 'projects', path: 'pause.by', targets: ['user'] },
  { collection: 'projects', path: 'pause.trackerId', targets: ['tracker'] },
  { collection: 'projects', path: 'stageBack.fromStageId', targets: ['stage'] },
  { collection: 'projects', path: 'stageBack.toStageId', targets: ['stage'] },
  { collection: 'projects', path: 'stageBack.by', targets: ['user'] },
  { collection: 'projects', path: 'createdBy', targets: ['user'] },

  { collection: 'members', path: 'projectId', targets: ['project'] },
  { collection: 'members', path: 'userId', targets: ['user'] },

  { collection: 'stages', path: 'projectId', targets: ['project'] },
  { collection: 'stages', path: 'prerequisiteIds[]', targets: ['stage'] },

  { collection: 'deadlines', path: 'projectId', targets: ['project'] },
  { collection: 'deadlines', path: 'stageId', targets: ['stage'] },

  { collection: 'tasks', path: 'projectId', targets: ['project'] },
  { collection: 'tasks', path: 'stageId', targets: ['stage'] },
  { collection: 'tasks', path: 'ownerId', targets: ['user'] },
  { collection: 'tasks', path: 'helperIds[]', targets: ['user'] },
  { collection: 'tasks', path: 'prerequisiteIds[]', targets: ['task'] },
  { collection: 'tasks', path: 'versions[].openedBy', targets: ['user'] },
  { collection: 'tasks', path: 'dateNotes[].byTaskId', targets: ['task'] },
  { collection: 'tasks', path: 'createdBy', targets: ['user'] },
  { collection: 'tasks', path: 'trackerEntryId', targets: ['tracker'] },

  { collection: 'updates', path: 'projectId', targets: ['project'] },
  { collection: 'updates', path: 'authorId', targets: ['user'] },
  { collection: 'updates', path: 'fileIds[]', targets: ['file'] },

  { collection: 'comments', path: 'targetId', targets: ['task', 'update'] },
  { collection: 'comments', path: 'authorId', targets: ['user'] },
  { collection: 'comments', path: 'reactions.*[]', targets: ['user'] },
  { collection: 'comments', path: 'fileIds[]', targets: ['file'] },
  { collection: 'comments', path: 'dates.byTaskId', targets: ['task'] },

  { collection: 'files', path: 'projectId', targets: ['project'] },
  { collection: 'files', path: 'stageId', targets: ['stage'] },
  { collection: 'files', path: 'taskId', targets: ['task'] },
  { collection: 'files', path: 'versions[].uploadedBy', targets: ['user'] },

  { collection: 'conversations', path: 'projectId', targets: ['project'] },
  { collection: 'conversations', path: 'memberIds[]', targets: ['user'] },

  // A direct chat message can carry a project file (attach.ts), so the file check reaches messages outside the project.
  { collection: 'messages', path: 'authorId', targets: ['user'] },
  { collection: 'messages', path: 'actingForId', targets: ['user'] },
  { collection: 'messages', path: 'mentions[]', targets: ['user'] },
  { collection: 'messages', path: 'fileIds[]', targets: ['file'] },

  // A read mark names a chat or a task whose comments the Inbox shows as a thread.
  { collection: 'chatReads', path: 'conversationId', targets: ['task'] },
  { collection: 'chatReads', path: 'userId', targets: ['user'] },

  { collection: 'stageTemplates', path: 'createdBy', targets: ['user'] },
  { collection: 'taskTemplates', path: 'createdBy', targets: ['user'] },
  { collection: 'projectTemplates', path: 'createdBy', targets: ['user'] },
  { collection: 'projectTemplates', path: 'roles[].defaultUserId', targets: ['user'] },

  { collection: 'tracker', path: 'projectId', targets: ['project'] },
  { collection: 'tracker', path: 'closedBy', targets: ['user'] },
  { collection: 'tracker', path: 'fileIds[]', targets: ['file'] },
  { collection: 'tracker', path: 'peopleIds[]', targets: ['user'] },
  { collection: 'tracker', path: 'createdBy', targets: ['user'] },
  { collection: 'tracker', path: 'replyTaskId', targets: ['task'] },

  { collection: 'payments', path: 'projectId', targets: ['project'] },
  { collection: 'payments', path: 'createdBy', targets: ['user'] },

  { collection: 'feedback', path: 'createdBy', targets: ['user'] },
  { collection: 'feedback', path: 'doneBy', targets: ['user'] },

  { collection: 'teams', path: 'memberIds[]', targets: ['user'] },
];

/** For each target type, the fields that can hold its id. A type with no entry (a member, a deadline, a comment) is never used elsewhere. */
export const REFERENCES: Record<EventTarget, readonly Reference[]> = Object.fromEntries(
  EventTarget.options.map((target) => [
    target,
    REFERENCE_FIELDS.filter((field) => field.targets.includes(target)).map(({ collection, path }) => ({ collection, path })),
  ]),
) as unknown as Record<EventTarget, readonly Reference[]>;

/** The values at a path of one record. A missing or null step gives no value. */
export function valuesAt(record: unknown, path: string): unknown[] {
  let current: unknown[] = [record];
  for (const step of path.split('.')) {
    const list = step.endsWith('[]');
    const name = list ? step.slice(0, -2) : step;
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || typeof value !== 'object') continue;
      const found = name === '*' ? Object.values(value) : [(value as Record<string, unknown>)[name]];
      for (const item of found) {
        if (item === undefined) continue;
        if (list) {
          if (Array.isArray(item)) next.push(...item);
        } else next.push(item);
      }
    }
    current = next;
  }
  return current;
}

/**
 * The path as a Postgres SQL/JSON path. Bind the id as a jsonpath variable, never paste it into the path text:
 * jsonb_path_exists(doc, $1::jsonpath, jsonb_build_object('id', $2::text)), with parameter 1 the path from here plus
 * ' ? (@ == $id)' and parameter 2 the target id. The @? operator takes no variables, so it cannot run this check.
 */
export function jsonPathOf(path: string): string {
  return `$.${path.split('.').map((step) => step.replace(/\[\]$/, '[*]')).join('.')}`;
}

/** The state key of each collection that a target type lives in, for the record that must not count itself. */
const OWN_COLLECTION: Partial<Record<EventTarget, RefCollection>> = {
  project: 'projects', member: 'members', stage: 'stages', deadline: 'deadlines', task: 'tasks', update: 'updates', comment: 'comments',
  file: 'files', client: 'clients', user: 'users', stageTemplate: 'stageTemplates', taskTemplate: 'taskTemplates', tracker: 'tracker',
  payment: 'payments', feedback: 'feedback', team: 'teams', projectTemplate: 'projectTemplates',
};

/** True when a record other than the target itself still holds the target's id in one of its reference fields. */
export function isReferenced(state: State, targetType: EventTarget, targetId: string): boolean {
  const own = OWN_COLLECTION[targetType];
  for (const ref of REFERENCES[targetType]) {
    const records = (state[ref.collection] ?? {}) as Record<string, unknown>;
    for (const [key, record] of Object.entries(records)) {
      if (ref.collection === own && key === targetId) continue;
      if (valuesAt(record, ref.path).includes(targetId)) return true;
    }
  }
  return false;
}
