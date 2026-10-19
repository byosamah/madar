import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Lang } from '../../lib/dates';

/**
 * The street map of the project pin and the Dashboard map (owner, 2026-10-19, fbk_017). The tiles and the glyphs come from
 * OpenFreeMap (OpenMapTiles schema). The style is written here, layer by layer, in Madar colors, with no points of interest.
 *
 * Zero cost is a hard rule (owner, 2026-10-19): a map service needs no account, no key and no bill. OpenFreeMap and the place
 * search of OpenStreetMap (Nominatim) pass. The own map file (functions/map, server/http/pagesMap.ts) stays in the repo as a later option.
 */

/** The free OpenFreeMap addresses. The CSP of config/headers.template names the host. */
export const MAP_SOURCE = {
  host: 'https://tiles.openfreemap.org',
  tiles: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
} as const;

/** The first view of a map with no pin: Al Khobar, the city of the office. */
export const START_POINT = { lat: 26.28, lng: 50.21 } as const;
export const START_ZOOM = 10;

export type MapTheme = 'light' | 'dark';

type Role = 'land' | 'landuse' | 'green' | 'water' | 'building' | 'road' | 'casing' | 'boundary' | 'label' | 'label2' | 'halo';

/**
 * The map colors. Each one is a token of src/design/tokens.css, in the block of its theme. mapStyle.test.ts checks that each
 * color is still a token, so a change of a token that the map uses needs a change here as well.
 * Light: the land is the page grey, the water the blue light, the parks the mint light, the roads white with a thin grey casing.
 * Dark: the same map on the dark page, with a deep navy water.
 */
export const MAP_COLORS: Record<MapTheme, Record<Role, string>> = {
  light: {
    land: '#F4F4F7', landuse: '#F0F0F2', green: '#CFF2E2', water: '#CCE0FF', building: '#FFFFFF',
    road: '#FFFFFF', casing: '#A1A1A6', boundary: '#A1A1A6', label: '#1D1D1F', label2: '#636366', halo: '#FFFFFF',
  },
  dark: {
    land: '#0D0D10', landuse: '#0F0F12', green: '#14301F', water: '#1B2A44', building: '#1A1A1E',
    road: '#26262B', casing: '#636366', boundary: '#636366', label: '#F5F5F7', label2: '#A1A1A6', halo: '#0D0D10',
  },
};

const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

type Zooms = [number, number][];
/** A width that grows with the zoom: a list of [zoom, width] pairs, scaled by a factor. */
const grow = (stops: Zooms, factor = 1, extra = 0) => [
  'interpolate', ['exponential', 1.4], ['zoom'],
  ...stops.flatMap(([zoom, width]) => [zoom, Number((width * factor + extra).toFixed(2))]),
] as never;
const ROAD_WIDTH: Zooms = [[5, 0.3], [8, 0.7], [11, 1.4], [13, 2.8], [15, 6], [17, 13], [19, 28]];

type RoadTier = { id: string; classes: string[]; minzoom: number; factor: number };
/** The road classes of OpenMapTiles, from the smallest to the largest: a larger road draws over a smaller one. */
const ROADS: RoadTier[] = [
  { id: 'service', classes: ['service', 'track'], minzoom: 15, factor: 0.45 },
  { id: 'minor', classes: ['minor'], minzoom: 13, factor: 0.65 },
  { id: 'tertiary', classes: ['tertiary'], minzoom: 11, factor: 0.85 },
  { id: 'secondary', classes: ['secondary'], minzoom: 9, factor: 1 },
  { id: 'primary', classes: ['primary'], minzoom: 7, factor: 1.15 },
  { id: 'trunk', classes: ['trunk'], minzoom: 5, factor: 1.3 },
  { id: 'motorway', classes: ['motorway'], minzoom: 5, factor: 1.45 },
];
// A road in a tunnel does not draw: it would hang over the roads above it.
const ON_GROUND = ['!=', ['get', 'brunnel'], 'tunnel'] as never;

/** The label text of the screen language: the Arabic name first on an Arabic screen, the English name first on an English one. */
const nameOf = (lang: Lang) => (lang === 'ar'
  ? ['coalesce', ['get', 'name:ar'], ['get', 'name']]
  : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]) as never;

/**
 * The layers of a theme and a language. The order is the order of drawing: the ground, the water, the buildings, the roads
 * (all casings, then all fills), the borders, and the labels last.
 */
function layersOf(theme: MapTheme, lang: Lang): LayerSpecification[] {
  const c = MAP_COLORS[theme];
  const source = 'openmaptiles';
  // Arabic letters join, so a letter gap would break the words.
  const spacing = (value: number) => (lang === 'ar' ? 0 : value);
  const halo = { 'text-halo-color': c.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 };
  const fill = (id: string, layer: string, color: string, filter: unknown, extra: Record<string, unknown> = {}): LayerSpecification => ({
    id, type: 'fill', source, 'source-layer': layer, ...(filter ? { filter } : {}), paint: { 'fill-color': color, ...extra },
  }) as LayerSpecification;

  const ground: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': c.land } },
    fill('landcover-green', 'landcover', c.green, ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland', 'wetland']]], { 'fill-opacity': 0.7 }),
    fill('landuse-green', 'landuse', c.green, ['in', ['get', 'class'], ['literal', ['cemetery', 'garden', 'playground', 'pitch', 'zoo', 'theme_park', 'stadium']]], { 'fill-opacity': 0.8 }),
    fill('landuse-tint', 'landuse', c.landuse, ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail', 'school', 'university', 'college', 'hospital', 'military']]]),
    fill('park', 'park', c.green, null, { 'fill-opacity': 0.85 }),
    fill('aeroway-area', 'aeroway', c.landuse, ['==', ['geometry-type'], 'Polygon']),
    fill('water', 'water', c.water, null),
    { id: 'waterway', type: 'line', source, 'source-layer': 'waterway', paint: { 'line-color': c.water, 'line-width': grow([[8, 0.6], [14, 2], [18, 6]]) } } as LayerSpecification,
    {
      id: 'building', type: 'fill', source, 'source-layer': 'building', minzoom: 14,
      paint: { 'fill-color': c.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 0.9] },
    } as LayerSpecification,
  ];

  const road = (tier: RoadTier) => ['in', ['get', 'class'], ['literal', tier.classes]] as never;
  const casings: LayerSpecification[] = ROADS.map((tier) => ({
    id: `road-${tier.id}-casing`, type: 'line', source, 'source-layer': 'transportation', minzoom: tier.minzoom,
    filter: ['all', road(tier), ON_GROUND, ['!=', ['get', 'subclass'], 'ferry']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.casing, 'line-opacity': 0.5, 'line-width': grow(ROAD_WIDTH, tier.factor, 1.1) },
  }) as LayerSpecification);
  const fills: LayerSpecification[] = ROADS.map((tier) => ({
    id: `road-${tier.id}`, type: 'line', source, 'source-layer': 'transportation', minzoom: tier.minzoom,
    filter: ['all', road(tier), ON_GROUND, ['!=', ['get', 'subclass'], 'ferry']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.road, 'line-width': grow(ROAD_WIDTH, tier.factor) },
  }) as LayerSpecification);
  const lines: LayerSpecification[] = [
    {
      id: 'road-path', type: 'line', source, 'source-layer': 'transportation', minzoom: 15,
      filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': c.casing, 'line-opacity': 0.8, 'line-width': 1, 'line-dasharray': [2, 2] },
    },
    {
      id: 'rail', type: 'line', source, 'source-layer': 'transportation', minzoom: 10,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'subclass'], 'subway']],
      paint: { 'line-color': c.boundary, 'line-opacity': 0.8, 'line-width': 0.9, 'line-dasharray': [4, 3] },
    },
    {
      id: 'boundary', type: 'line', source, 'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': c.boundary, 'line-opacity': 0.7, 'line-width': 1, 'line-dasharray': [3, 2] },
    },
  ] as LayerSpecification[];

  const text = (id: string, layer: string, filter: unknown, layout: Record<string, unknown>, paint: Record<string, unknown>, extra: Record<string, unknown> = {}): LayerSpecification => ({
    id, type: 'symbol', source, 'source-layer': layer, ...(filter ? { filter } : {}), ...extra,
    layout: { 'text-field': nameOf(lang), 'text-font': REGULAR, 'text-padding': 6, 'text-max-width': 7, ...layout },
    paint: { ...halo, ...paint },
  }) as LayerSpecification;
  const place = (id: string, classes: string[], extra: Record<string, unknown>, layout: Record<string, unknown>, color: string) =>
    text(id, 'place', ['in', ['get', 'class'], ['literal', classes]], { 'symbol-sort-key': ['coalesce', ['get', 'rank'], 100], ...layout }, { 'text-color': color }, extra);

  const labels: LayerSpecification[] = [
    text('water-label', 'water_name', null, { 'text-size': 12, 'text-letter-spacing': spacing(0.1) }, { 'text-color': c.label2 }, { minzoom: 5 }),
    text('road-label-major', 'transportation_name', ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      { 'symbol-placement': 'line', 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13], 'text-padding': 8, 'symbol-spacing': 520 }, { 'text-color': c.label2 }, { minzoom: 13 }),
    text('road-label-minor', 'transportation_name', ['in', ['get', 'class'], ['literal', ['tertiary', 'minor']]],
      { 'symbol-placement': 'line', 'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10.5, 18, 13], 'text-padding': 10, 'symbol-spacing': 640 }, { 'text-color': c.label2 }, { minzoom: 16 }),
    place('place-suburb', ['suburb', 'quarter', 'neighbourhood'], { minzoom: 12 },
      { 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13] }, c.label2),
    place('place-village', ['village', 'hamlet', 'isolated_dwelling'], { minzoom: 10 },
      { 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 14] }, c.label2),
    place('place-town', ['town'], { minzoom: 7 },
      { 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 12, 12, 17] }, c.label),
    place('place-city', ['city'], { minzoom: 4 },
      { 'text-font': BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 8, 15, 11, 19, 14, 22] }, c.label),
    place('place-state', ['state', 'province'], { minzoom: 4, maxzoom: 8 },
      { 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13], 'text-letter-spacing': spacing(0.08) }, c.label2),
    place('place-country', ['country'], { minzoom: 2, maxzoom: 6 },
      { 'text-font': BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 12, 5, 15] }, c.label2),
  ];

  return [...ground, ...casings, ...fills, ...lines, ...labels];
}

/**
 * The style of the map for a theme and a language. Labels show the name of the screen language (the Arabic name first on an
 * Arabic screen, then the plain name). OpenFreeMap serves the tiles and the glyphs: no account, no key, no bill.
 */
export function madarMapStyle(theme: MapTheme, lang: Lang): StyleSpecification {
  return {
    version: 8,
    name: 'Madar',
    glyphs: MAP_SOURCE.glyphs,
    sources: { openmaptiles: { type: 'vector', url: MAP_SOURCE.tiles } },
    layers: layersOf(theme, lang),
  };
}
