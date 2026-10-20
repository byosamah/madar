/**
 * The sign-in token for the requests that MapLibre makes outside the API client: the satellite tiles of our own route
 * (src/features/map/satellite.ts). The bootstrap of the real build gives the source; the prototype has none, so it gives null.
 */
let source: () => Promise<string | null> = async () => null;

export function setTileTokenSource(next: () => Promise<string | null>): void {
  source = next;
}

export function tileToken(): Promise<string | null> {
  return source();
}
