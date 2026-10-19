/**
 * The one gate for every request to OpenStreetMap Nominatim (place search and address lookup). The policy of Nominatim asks for one
 * request at a time and at least one second between two requests. All requests of the screens go through this gate, so a search and a
 * lookup of an address never run together.
 */

/** The least time between the starts of two requests, as the Nominatim policy asks. */
export const GATE_GAP_MS = 1000;

const waiting: (() => void)[] = [];
// True from the moment a request is taken until it ends.
let active = false;
let lastStart = Number.NEGATIVE_INFINITY;
// Counts the clears, so a request that waited for a timer before a clear never starts after it.
let generation = 0;

function next(): void {
  if (active) return;
  const start = waiting.shift();
  if (!start) return;
  active = true;
  const delay = Math.max(0, lastStart + GATE_GAP_MS - Date.now());
  const mine = generation;
  if (delay === 0) start();
  else setTimeout(() => mine === generation && start(), delay);
}

/**
 * Runs one request through the gate. A request starts in the same turn when the gate is free and the last start is more than one
 * second old. Else it waits its turn. A failed request does not block the next one.
 */
export function gated<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      lastStart = Date.now();
      let result: Promise<T>;
      try {
        result = run();
      } catch (error) {
        result = Promise.reject(error);
      }
      result.then(resolve, reject).finally(() => {
        active = false;
        next();
      });
    });
    next();
  });
}

/** Clears the gate. Only the tests call it, so one test never waits for the request of the test before. */
export function resetGate(): void {
  waiting.length = 0;
  active = false;
  lastStart = Number.NEGATIVE_INFINITY;
  generation += 1;
}
