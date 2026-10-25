/**
 * The small part of the insight module that any screen file may import. It holds no PostHog code and no import of the router, so
 * the error page and the sheets can call it with no import cycle (insight design, section 6). `index.ts` re-exports it.
 */

/** The person of an error record: the Madar person id and the English display name. Actions never carry it. */
export type InsightPerson = { id: string; name: string };

/** The main sheets that the owner counts (insight design, section 4). */
export type SheetName = 'newProject' | 'newTask' | 'newOfficeTask' | 'payment' | 'meeting' | 'trackerLog' | 'feedback';
export type SheetStep = 'open' | 'save' | 'close_unsaved';

/** What the lazy client gives to the rest of Madar. */
export type InsightClient = {
  track(event: string, props?: Record<string, unknown>): void;
  exception(error: unknown, props?: Record<string, unknown>): void;
  stop(): void;
};

let running: InsightClient | null = null;

/** Called by `index.ts` only: the client that runs now, or null after a sign-out. */
export function setInsightClient(client: InsightClient | null): void {
  running = client;
}

/** A broken screen or a failed call. It carries the person (the client adds it). A no-op while no client runs. */
export function reportError(error: unknown, where: string): void {
  try {
    running?.exception(error, { where });
  } catch {
    // PostHog is never allowed to break Madar.
  }
}

/** A batch request that took too long: the call names and the time. No person. */
export function noteSlow(calls: string[], ms: number): void {
  try {
    running?.track('madar_slow_request', { calls, ms });
  } catch {
    // PostHog is never allowed to break Madar.
  }
}

/** One step of a main sheet. No person. */
export function noteSheet(name: SheetName, step: SheetStep): void {
  try {
    running?.track('madar_sheet', { sheet: name, step });
  } catch {
    // PostHog is never allowed to break Madar.
  }
}
