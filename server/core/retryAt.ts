/**
 * The time to try again that an error names, or null. An error with a `retryAt` date (the NetBudgetSpent of the office object,
 * server/office/net.ts) is not a failure: the outbox row waits until that time and keeps its attempt (server/core/effects.ts).
 * A client of an outside service (Google, Daftra) lets such an error pass, so it never turns into a false problem.
 */
export function retryAtOf(error: unknown): Date | null {
  const at = (error as { retryAt?: unknown } | null)?.retryAt;
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : null;
}
