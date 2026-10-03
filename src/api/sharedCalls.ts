import { mapCalls } from './calls';

/**
 * The calls that the server runs (plan, change 1): the map without the prototype controls and without files.get, whose Blob output
 * JSON cannot carry (the real screens use files.link). session.get stays: every screen needs it, and the server ignores prototypeOnly.
 */
export const SERVER_EXCLUDED = ['session.previewAs', 'session.setSimulateErrors', 'session.resetSampleData', 'files.get'] as const;
export type ServerExcluded = (typeof SERVER_EXCLUDED)[number];

type MapCalls = typeof mapCalls;
export type SharedCalls = Omit<MapCalls, ServerExcluded>;
export type SharedCallName = keyof SharedCalls & string;

export const sharedCalls: SharedCalls = Object.fromEntries(
  Object.entries(mapCalls).filter(([name]) => !(SERVER_EXCLUDED as readonly string[]).includes(name)),
) as SharedCalls;
