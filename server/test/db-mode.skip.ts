/**
 * The API tests that do not run in db mode (TM 4.2), each with its reason. The db setup file (server/test/db.ts) skips them
 * before they start. A whole file has no "test"; one test is named by its full name: the describe names and the test name,
 * joined by spaces, as Vitest prints it.
 *
 * Keep this list short. A line here hides a test from the real server, so each line needs a reason that a reviewer accepts:
 * the call does not exist on the server, the test checks a prototype-only field or rule, or it waits for the work of a track
 * that merges later (until).
 */

import { existsSync } from 'node:fs';

/**
 * until: a file of another track, by path from the repository root. The line holds only while that file is missing, so the test
 * runs again by itself on the day that track merges.
 */
export type SkipEntry = { file: string; test?: string; reason: string; until?: string };

const ROOT = new URL('../../', import.meta.url);

export const DB_MODE_SKIP: readonly SkipEntry[] = [
  {
    file: 'src/api/handlers/system.test.ts',
    reason: 'session.resetSampleData is a prototype control. The server does not have it (SERVER_EXCLUDED), and the real office starts empty.',
  },
  {
    file: 'src/api/handlers/people.test.ts',
    test: 'session calls returns the current user and the preview list',
    reason: 'It checks the prototype fields of session.get: the server returns persistent true and an empty previewUsers list (plan, change 18).',
  },
  {
    file: 'src/api/handlers/people.test.ts',
    test: 'Management and people shows the role in the Preview as list',
    reason: 'It reads previewUsers of session.get, which the server always returns empty (plan, change 18). Preview as is a prototype control.',
  },
  {
    file: 'src/api/handlers/serverFakes.test.ts',
    reason:
      'It tests the fake versions of the 9 server calls (src/api/handlers/serverFakes.ts, T0.3), such as cor_ story IDs and blob: links. '
      + 'The server runs the real calls, and each owner track tests them on the server: C3 story.start, F the files and feedback calls, '
      + 'P the invitations, G the agents, M usage.get.',
  },
  {
    file: 'src/api/handlers/payments.test.ts',
    test: 'who may use the payment calls refuses an inactive person with the right',
    reason:
      'It expects forbidden for a turned-off person. The server refuses that person before any rule, with unauthenticated and the '
      + 'reason account_off, and the screens show the sign-in message (plan 4.5, the actor; server/core/actor.test.ts).',
  },
  {
    file: 'src/api/handlers/chats.test.ts',
    test: 'task threads follow the comment read rule shows a thread to a removed member exactly when comments.list lets them read it',
    reason:
      'Its last part turns the person off and expects forbidden from comments.list and an answer from chats.list. The server refuses '
      + 'both with unauthenticated and the reason account_off (plan 4.5, the actor). The removed-member part runs in the chats tests of C2.',
  },
  {
    file: 'src/api/handlers/projectsAudit.test.ts',
    test: 'Deleting a project removes its Tracker entries and its file data (audit 2026-10-03, API-17) saves the office without the project before it removes the file data (review 2026-10-03)',
    reason:
      'It spies on the save method of the browser store, which the server does not have. On the server the order is the outbox rule: '
      + 'the data goes in an effect after the commit (plan 4.12), and F tests it in server/it/files.it.test.ts.',
  },
  {
    file: 'src/api/handlers/projectsAudit.test.ts',
    test: 'Deleting a project removes its Tracker entries and its file data (audit 2026-10-03, API-17) leaves no Tracker entry and no stored file data of the project',
    until: 'server/files/effects.ts',
    reason:
      'The stored data of a deleted project goes with the effect of track F (server/files/effects.ts). Until F merges, the prepare '
      + 'hook of projects.delete is the T0 stub that lists no data key, so the data stays.',
  },
  {
    file: 'src/api/handlers/flow.test.ts',
    test: 'stage prerequisites refuses cycles, other projects and repeats, and only the leader and the Admin set them',
    reason:
      'Test data: it adds stg_099 in prj_099, a project that does not exist, and the database refuses that stage (TM 3.6). The D2 '
      + 'report gives the merge lead a patch that adds prj_099 to the test and removes this line.',
  },
];

/** The reason to skip a test, or undefined. filepath: the absolute path of the test file. */
export function skipReason(filepath: string, fullName: string, list: readonly SkipEntry[] = DB_MODE_SKIP): string | undefined {
  const path = filepath.replace(/\\/g, '/');
  const entry = list.find(
    (one) => path.endsWith(`/${one.file}`) && (one.test === undefined || one.test === fullName) && (one.until === undefined || !existsSync(new URL(one.until, ROOT))),
  );
  return entry?.reason;
}
