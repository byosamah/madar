# Map

The project pin and the map. `MapCanvas.tsx` is the one MapLibre wrapper. `PinPicker.tsx` is the one field of the pin.
`PinSheet.tsx`, `ProjectPin.tsx`, `mapStyle.ts` and `satellite.ts` complete the set. `src/lib/geo.ts` reads a pasted link or a pair
of coordinates. The Dashboard Map tab is `src/features/dashboard/DashboardMap.tsx`.

## Load rules
- MapLibre loads only in the real build. `PinPicker.tsx` and `loadMapLib` (`mapLib.ts`) fold `import.meta.env.VITE_MADAR_API === 'remote'`
  themselves. `REMOTE` from `app/mode.ts` does not fold: the prototype would keep the map code, its stylesheet and a second script file.
  `scripts/check-bundles.ts` fails a prototype dist or a first load that holds the `maplibregl-` marker.
- `mapLib.ts` is the loader and holds no map code. A screen makes its lazy canvas with `lazyMapCanvas()`, which starts the library request
  with the chunk request. A pointer down on the Dashboard Map tab calls `warmMap()`. The map never joins the idle prefetch.
- The worker is a `?worker&url` import (it needs its own imports bundled). `releaseUrl` adds `VITE_MADAR_BUILD` to the worker address:
  a browser keeps an assets file for a year, and the worker obeys the policy header of its own file.
- The Arabic text plugin is a file of this build. `MapCanvas.tsx` imports `@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url` by a
  path into `node_modules`. Its WebAssembly needs `'wasm-unsafe-eval'` in `script-src` (`config/headers.template`). Never load it from a CDN.
- A test that runs the loader sets the flag and mocks the library: `vi.mock('maplibre-gl', () => import('<path>/test/fakeMapLib'))`. The
  real library makes a Worker. jsdom has none, and `npm test` then ends with exit code 1 while every test passes. `mapTestRule.test.ts`
  holds the rule.

## Cost and terms
- A map service has no account, no key and no bill. OpenFreeMap (tiles and glyphs) and OpenStreetMap Nominatim (the place search) pass.
  `mapStyle.test.ts` pins the one host in the style. Never add a paid or keyed service (Mapbox, Google Maps JS, MapTiler, Stadia).
- The one exception is the satellite view. The browser never asks Esri. The style (`satellite.ts`) asks `madar-satellite://tile/{z}/{y}/{x}`.
  The loader (`addProtocol`) fetches our own route `/satellite/<z>/<y>/<x>` with the sign-in token (`app/remote/tileToken.ts`, set by the
  bootstrap). The key, the referrer, the quota and the no-stored-tiles terms live in `functions/CLAUDE.md`. Never keep a tile on our side.
- `VITE_MADAR_SATELLITE=on` in `config/remote.<env>.env` shows the button. Without it there is no button. `MapCanvas` keeps the choice in
  `madar.mapLayer`. "Powered by Esri" shows beside the credit button while the pictures show. An error of the satellite source before
  its first tile goes back to the street map with one line and hides the button. The CSP needs no Esri host.
- The credit is the small MapLibre button inside the map (`AttributionControl`, `compact`, `MAP_CREDIT`, folded by `foldCredit`). Never
  remove it and never move it to a line under the map: the data is free only with the credit (ODbL).
- The style is written by hand for the OpenMapTiles layers. `MAP_COLORS` are tokens (`mapStyle.test.ts` checks it). Labels follow the
  screen language (`name:ar` first in Arabic). The glyph stacks are `Noto Sans Regular` and `Noto Sans Bold` (both hold the Arabic block).
- The own map file (`functions/map`, `server/http/pagesMap.ts`, `scripts/map/build-basemap.sh`) stays in the repo as a later option. No
  screen uses it.

## Layout and pins
- The map box is `dir="ltr"`: MapLibre places pins, cards and controls left to right, and an Arabic page put them far away. The card of a
  pin sets the language direction again.
- A pin is a React tree in a MapLibre marker (a portal). `ProjectPin` is the project tile with a ring, and the status shape on Late and At
  risk only. A press opens a MapLibre popup on a computer, and a sheet on a phone or when the map did not load. When the map cannot start,
  the box shows one line.
- `fullscreen` on `MapCanvas` adds the full screen button. A browser with no full screen (iPhone) fills its window.
- The About panel shows the pin in place of the cover (`features/project/overview/ProjectPlace.tsx`, a `compact` map), only in the real
  build and only when the project has a pin. The Dashboard map reads `projects.list` with the Leader, Client and Team filters and folds the
  flag itself. The prototype shows the pinned list and a note.

## The pin is the place
- The place is one record: the pin. A saved location link that holds coordinates inside Saudi Arabia sets the pin in the same save
  (`saveLinks` in `src/api/handlers/projects.ts`). Old data with no pin (`geo` undefined, never null) shows the place of its location link
  (`pinFromLinks` in `src/api/views.ts`). A removed pin is null and stays removed.
- The form has one field, "Location" (`LocationField` in `ProjectFields.tsx`), and no free text. It shows the address, "Pinned on the map."
  or "No location yet". An old project with typed text and no pin shows its text until someone sets a pin.
- `PinSheet` hands over the point and its address: `onUse(point, address)`. The address is the name of a search hit, else one lookup at
  Nominatim when the person presses "Use this place" (`addressOf` in `src/lib/placeAddress.ts`; never while the pin moves). A failed or slow
  lookup (5 s) gives '' and the pin still saves. The prototype gives '' there, never raw numbers.
- One write: the form, the Dashboard map and the link sheet send `geo` and `location` together in one `projects.update` (or one
  `projects.addLink` or `updateLink` with `location`), so one Undo takes both back. The server clears the text of a pin that moves with no
  text (`src/api/handlers/CLAUDE.md`, "Projects"). `LinkSheet` (`features/project/files/ProjectLinks.tsx`) looks up the address of a location link before the
  save, only when the link moves the pin and the person may edit.
- The picker reads a link or two coordinates at once. A name is searched on Enter only (`src/lib/placeSearch.ts`), with one more search
  with a shorter name when nothing is found. A pair outside Saudi Arabia (`inSaudi`) sets no pin and offers "Swap them". A short Google Maps
  link goes to the Pages Function `/maplink`, which follows the redirect. The prototype has no server and no search.
- `src/lib/nominatimGate.ts` (`gated`) runs every Nominatim request one at a time and at least 1 s after the last start, for the search and
  the lookup together. Send no header and no referrer of our own (`Referrer-Policy: no-referrer`). A test that sends a search calls
  `resetGate()` first.
