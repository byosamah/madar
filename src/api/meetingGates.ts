import { can, type Actor, type Resource } from './permissions';

/**
 * The gates of a meeting (role rights version 2, design 5.3). The organizer changes a meeting with meeting.editOwn. A person who holds
 * meeting.any for the project (its leader, or every project) changes any meeting of the project. The minutes follow the same pair:
 * meeting.minutesOwn for the organizer and the attendees, meeting.minutesAny for the leader or every project. A meeting with no
 * project has no "any" switch: only its people change it.
 */

/** True when the person may change, cancel, delete or extend the meeting. */
export function mayEditMeeting(actor: Actor, resource: Resource): boolean {
  return can(actor, 'meeting.editOwn', resource) || can(actor, 'meeting.any', resource);
}

/** True when the person may write the minutes of the meeting, and add its files. */
export function mayWriteMinutes(actor: Actor, resource: Resource): boolean {
  return can(actor, 'meeting.minutesOwn', resource) || can(actor, 'meeting.minutesAny', resource);
}
