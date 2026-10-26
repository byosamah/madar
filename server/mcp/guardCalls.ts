import { z } from 'zod';

/**
 * The acts that need an email code when an agent does them (owner decision, 2026-10-26; the flow is in guard.ts). This file holds the
 * names and the argument of the tool only, with no server code, so tools.ts and docs can read it.
 */
export const GUARDED_CALLS: ReadonlySet<string> = new Set([
  'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'roles.create', 'roles.update', 'roles.delete',
]);

/** The name of the argument. It is an argument of the tool only: runCall takes it out of the input before the parse. */
export const CONFIRM_FIELD = 'confirmCode';

/** The argument of the tool: six digits from the email of the person. */
export const ConfirmCode = z.string().regex(/^\d{6}$/);
