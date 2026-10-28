import { lazy } from 'react';
import type * as MapLib from 'maplibre-gl';
import { SATELLITE_SCHEME, loadSatelliteTile } from './satellite';

/**
 * The loader of the street map (owner, 2026-10-18, fbk_017; speed audit 2026-10-21, FL-17 and LV-10). This file is small and holds
 * no map code: MapLibre and its worker are dynamic imports. The three screens that show a map (the project
 * About panel, the Dashboard Map tab and the pin picker) import it, and only in the real build: each one folds the flag itself, so
 * the prototype keeps no map code.
 */

let loading: Promise<typeof MapLib> | undefined;

/**
 * The address of a file with the release in it. A browser keeps an assets file for a year with the policy header of its first
 * fetch, and the map worker obeys its own header, not the page's. A new address each release makes the browser fetch the worker
 * again with the policy of this release (the owner's map showed no tiles under the old policy, 2026-10-19).
 */
export function releaseUrl(url: string, release: string | undefined): string {
  return `${url}?release=${encodeURIComponent(release ?? '0')}`;
}

/**
 * Loads MapLibre once (owner, 2026-10-18, fbk_017). The worker is a file of this build, so the page needs no blob worker in its
 * policy. MapLibre 6 shapes Arabic text by itself, so the loader sets no Arabic text plugin: the plugin ran with eval(), which
 * the policy blocks, and gave an unhandled error (owner, 2026-10-28, tsk_486).
 * The tiles and the glyphs come from OpenFreeMap (mapStyle.ts). A failed load leaves nothing, so the next call tries again: a press on the Map tab
 * may start the load before the map needs it (`warmMap`), and a weak network must not stop the map after that.
 */
export function loadMapLib(): Promise<typeof MapLib> {
  loading ??= (async () => {
    // The flag is folded here, as in the three screens: the prototype build drops the branch, so the `?url` file of the worker is
    // never emitted there. Without it the prototype build would carry a second script file.
    const [lib, worker] = await (import.meta.env.VITE_MADAR_API === 'remote'
      ? Promise.all([
        import('maplibre-gl'),
        import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
        import('maplibre-gl/dist/maplibre-gl.css'),
        import('./mapPopup.css'),
      ])
      : Promise.reject(new Error('The street map is in the real build only.')));
    lib.setWorkerUrl(releaseUrl(worker.default, import.meta.env.VITE_MADAR_BUILD));
    lib.addProtocol(SATELLITE_SCHEME, loadSatelliteTile);
    return lib;
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

const quiet = () => undefined;

/**
 * The lazy MapCanvas of a screen. The library request starts with the chunk request of the canvas, so the two downloads overlap
 * (FL-17), where the library started only after the canvas chunk ran. A failed library load shows at the canvas, which asks again.
 */
export function lazyMapCanvas() {
  return lazy(() => {
    loadMapLib().catch(quiet);
    return import('./MapCanvas');
  });
}

/**
 * Starts the canvas chunk and the library when a person presses the Map tab (LV-10), before the click ends. It never makes a map and
 * asks for no tile. It never runs at idle: the library is about 300 KB gz.
 */
export function warmMap(): void {
  import('./MapCanvas').catch(quiet);
  loadMapLib().catch(quiet);
}
