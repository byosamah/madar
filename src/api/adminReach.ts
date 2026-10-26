import type { AdminReach, User } from './contract/entities';

/**
 * What reaches a person (owner, 2026-10-23). Only a person with the Admin role has a choice: every other person reads "mixed", whatever
 * is stored. A missing value means "mixed", which is the rule of chat design item 23. The loader, the handlers and the screens all read
 * this one rule. The file imports only types, so a first-load screen (Home) can use it with no zod code (2026-10-26, bundle check).
 */
export function adminReachOf(user: Pick<User, 'systemRole' | 'preferences'>): AdminReach {
  return user.systemRole === 'admin' ? (user.preferences.adminReach ?? 'mixed') : 'mixed';
}
