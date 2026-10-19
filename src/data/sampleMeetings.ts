import type { Meeting } from '../api/contract/entities';
import { meetingsOf, nextId, type State } from '../api/store';
import { addDays } from '../lib/dates';
import { addMinutes } from '../lib/meetings';
import { firstWorkingDay } from '../lib/workdays';

/**
 * The two sample meetings (fbk_022, 2026-10-19). The prototype adds them on its first start and on "Reset sample data"
 * (bootstrap.ts, sampleOffice.ts). buildSeed does not, as for the sample sub-companies: the screen tests and the deploy suite plan
 * their own meetings in the plain sample office.
 *
 * One client meeting of an open project, on the next working day, with its leader as the organizer. One meeting with no project,
 * two working days later: the Admin meets a new client with the leader, so only those two people see it (owner, 2026-10-19).
 */
export function addSampleMeetings(state: State, today: string): void {
  const project = Object.values(state.projects).find((one) => one.status === 'active' && one.leaderId !== null);
  const admin = Object.values(state.users).find((user) => user.systemRole === 'admin' && user.kind === 'human' && user.active);
  if (!project || !admin) return;
  const leaderId = project.leaderId as string;
  const team = Object.values(state.members).filter((member) => member.projectId === project.id && member.userId !== leaderId).map((member) => member.userId);
  const created = `${addDays(today, -2)}T09:00:00.000+03:00`;
  const firstDay = firstWorkingDay(addDays(today, 1));
  const secondDay = firstWorkingDay(addDays(firstDay, 1));
  const make = (fields: Omit<Meeting, 'id' | 'status' | 'rev' | 'createdBy' | 'createdAt' | 'endsAt'> & { minutes: number }) => {
    const id = nextId(state, 'mtg');
    const { minutes, ...rest } = fields;
    meetingsOf(state)[id] = { ...rest, id, endsAt: addMinutes(rest.startsAt, minutes), status: 'scheduled', rev: 1, createdBy: rest.organizerId, createdAt: created };
  };
  make({
    kind: 'client', title: 'Review the facade options with the client', projectId: project.id, startsAt: `${firstDay}T10:00:00.000+03:00`, minutes: 60,
    where: 'Client office, Al Khobar', guests: 'The owner of the building', notes: 'Bring the three facade studies.',
    organizerId: leaderId, attendeeIds: team.slice(0, 2), minutesById: leaderId,
  });
  make({
    kind: 'meeting', title: 'Meet a new client about a villa in Dhahran', projectId: null, startsAt: `${secondDay}T13:00:00.000+03:00`, minutes: 60,
    where: 'Meeting room', guests: '', notes: '',
    organizerId: admin.id, attendeeIds: leaderId === admin.id ? [] : [leaderId], minutesById: admin.id,
  });
}
