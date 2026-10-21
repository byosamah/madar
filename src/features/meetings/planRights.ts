import { useCan } from '../../app/useRight';

/**
 * What the person may plan (role rights version 2): a meeting with no project needs meeting.plan.none, a meeting of a project needs
 * meeting.plan.team (a project where the person is on the team) or meeting.plan.all (every project). The leader counts as on the team.
 */
export function usePlanRights(): { none: boolean; team: boolean; all: boolean; any: boolean } {
  const may = useCan();
  const none = may('meeting.plan', { meeting: { organizerId: '', attendeeIds: [], noProject: true } });
  const team = may('meeting.plan', { projectRole: 'team', meeting: { organizerId: '', attendeeIds: [], noProject: false } });
  const all = may('meeting.plan', { projectRole: 'other', meeting: { organizerId: '', attendeeIds: [], noProject: false } });
  return { none, team, all, any: none || team || all };
}
