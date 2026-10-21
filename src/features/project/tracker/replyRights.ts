import type { ProjectDetail, UserCard } from '../../../api/contract/views';
import { useRight } from '../../../app/useRight';

/**
 * What the person may do with a reply to the client (role rights version 2). "Ask to reply" and "Assign a reply" make a to-do, so they need
 * tracker.reply and the right to add a to-do to this project. Naming another person as the one who replies also needs task.assign.
 */
export function useReplyRights(detail: ProjectDetail | undefined): { canReply: boolean; canAssign: boolean } {
  const reply = useRight('tracker.reply');
  const assign = useRight('task.assign');
  return { canReply: reply && detail?.viewerCan.addTask === true, canAssign: assign };
}

/** The people who may be named as the one who replies: all the members, or only the person when task.assign is off. */
export function repliers(members: UserCard[], me: string | undefined, canAssign: boolean): UserCard[] {
  return canAssign ? members : members.filter((member) => member.id === me);
}
