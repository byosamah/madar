import type { NotificationTarget, Project } from './contract/entities';
import type { State } from './store';

/**
 * The project that a notice target belongs to, or undefined: a project itself, a project task, a post, a project chat or a project
 * meeting. An office task, a direct chat, a group, a meeting with no project and a report belong to no project. Hidden projects
 * (owner, 2026-10-22): notify skips a person who does not see this project.
 */
export function projectOfTarget(state: Pick<State, 'projects' | 'tasks' | 'updates' | 'conversations' | 'meetings'>, targetType: NotificationTarget, targetId: string): Project | undefined {
  const projectId = ((): string | null | undefined => {
    switch (targetType) {
      case 'project':
        return targetId;
      case 'task':
        return state.tasks[targetId]?.projectId;
      case 'update':
        return state.updates[targetId]?.projectId;
      case 'chat':
        return state.conversations[targetId]?.projectId;
      case 'meeting':
        return state.meetings?.[targetId]?.projectId;
      default:
        return null;
    }
  })();
  return projectId ? state.projects[projectId] : undefined;
}
