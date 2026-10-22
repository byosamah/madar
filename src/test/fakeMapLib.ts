/**
 * A stand-in for MapLibre in the screen tests that run the map loader of the real build (`features/map/mapLib.ts`). Those tests
 * replace `MapCanvas`, but `lazyMapCanvas` still starts the loader, and the real library makes a Worker in `setRTLTextPlugin`.
 * jsdom has no Worker, so each test left "Worker is not defined" errors and `npm test` ended with exit code 1 (2026-10-22).
 * The loader calls only these three. Use it with `vi.mock('maplibre-gl', () => import('<path>/test/fakeMapLib'))`.
 */
export const setWorkerUrl = (): void => undefined;
export const setRTLTextPlugin = (): Promise<void> => Promise.resolve();
export const addProtocol = (): void => undefined;
