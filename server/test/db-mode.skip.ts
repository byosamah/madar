/**
 * The API tests that do not run in db mode (TM 4.2), each with its reason. The db setup file (server/test/db.ts) skips them
 * before they start. A whole file has no "test"; one test is named by its full name: the describe names and the test name,
 * joined by spaces, as Vitest prints it.
 *
 * Keep this list short. A line here hides a test from the real server, so each line needs a reason that a reviewer accepts:
 * the call does not exist on the server, or the test checks a prototype-only field.
 */

export type SkipEntry = { file: string; test?: string; reason: string };

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
];

/** The reason to skip a test, or undefined. filepath: the absolute path of the test file. */
export function skipReason(filepath: string, fullName: string): string | undefined {
  const path = filepath.replace(/\\/g, '/');
  const entry = DB_MODE_SKIP.find((one) => path.endsWith(`/${one.file}`) && (one.test === undefined || one.test === fullName));
  return entry?.reason;
}
