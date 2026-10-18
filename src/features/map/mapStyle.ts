import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Lang } from '../../lib/dates';

/**
 * The street map of the project pin and the Dashboard map (owner, 2026-10-18, fbk_017). It draws the Protomaps layers of the
 * own map file, in Madar colors, with no points of interest. The map file, the glyphs and the Arabic text plugin come from the
 * own address (functions/map, served by the Pages Function).
 */

/** The own addresses of the map. functions/map/[[path]].ts serves them. */
export const MAP_PATHS = {
  file: '/map/sa.pmtiles',
  glyphs: '/map/fonts/{fontstack}/{range}.pbf',
  rtlText: '/map/rtl-text.js',
} as const;

/** The first view of a map with no pin: Al Khobar, the city of the office. */
export const START_POINT = { lat: 26.28, lng: 50.21 } as const;
export const START_ZOOM = 10;

export type MapTheme = 'light' | 'dark';

type Role = 'land' | 'green' | 'water' | 'building' | 'road' | 'casing' | 'boundary' | 'label' | 'halo';

/**
 * The map colors. Each one is a token of src/design/tokens.css, in the block of its theme. mapStyle.test.ts checks that each
 * color is still a token, so a change of a token that the map uses needs a change here as well.
 */
export const MAP_COLORS: Record<MapTheme, Record<Role, string>> = {
  light: { land: '#F4F4F7', green: '#E7F6EE', water: '#E8F0FE', building: '#F0F0F2', road: '#FFFFFF', casing: '#A1A1A6', boundary: '#A1A1A6', label: '#1D1D1F', halo: '#FFFFFF' },
  dark: { land: '#0D0D10', green: '#14301F', water: '#1B2A44', building: '#26262B', road: '#1A1A1E', casing: '#636366', boundary: '#636366', label: '#F5F5F7', halo: '#0D0D10' },
};

/** The Protomaps color keys of each role. Every color key of a flavor is listed, so no Protomaps color stays on the map. */
const KEYS_OF_ROLE: [Role, string[]][] = [
  ['land', ['background', 'earth', 'sand', 'beach', 'glacier', 'runway', 'aerodrome']],
  ['green', ['park_a', 'park_b', 'wood_a', 'wood_b', 'scrub_a', 'scrub_b', 'zoo']],
  ['building', ['buildings', 'industrial', 'hospital', 'school', 'military', 'pier']],
  ['water', ['water']],
  ['road', [
    'minor_a', 'minor_b', 'minor_service', 'other', 'link', 'major', 'highway', 'pedestrian',
    'tunnel_other', 'tunnel_minor', 'tunnel_link', 'tunnel_major', 'tunnel_highway',
    'bridges_other', 'bridges_minor', 'bridges_link', 'bridges_major', 'bridges_highway',
  ]],
  ['casing', [
    'railway', 'minor_service_casing', 'minor_casing', 'link_casing', 'major_casing_early', 'major_casing_late',
    'highway_casing_early', 'highway_casing_late', 'tunnel_other_casing', 'tunnel_minor_casing', 'tunnel_link_casing',
    'tunnel_major_casing', 'tunnel_highway_casing', 'bridges_other_casing', 'bridges_minor_casing', 'bridges_link_casing',
    'bridges_major_casing', 'bridges_highway_casing',
  ]],
  ['boundary', ['boundaries']],
  ['label', ['ocean_label', 'subplace_label', 'city_label', 'state_label', 'country_label', 'address_label', 'roads_label_minor', 'roads_label_major']],
  ['halo', ['subplace_label_halo', 'city_label_halo', 'state_label_halo', 'address_label_halo', 'roads_label_minor_halo', 'roads_label_major_halo']],
];

/**
 * The Protomaps flavor of a theme, with every color set to a Madar color. Every text uses Noto Sans Regular, the one glyph
 * stack that the map uploads (proof.md, Map basemap probe). The Medium and Italic names would ask for files the route refuses.
 */
function flavorOf(theme: MapTheme): Flavor {
  const base = theme === 'dark' ? DARK : LIGHT;
  const colors = MAP_COLORS[theme];
  const roleColors: Record<string, string> = {};
  for (const [role, keys] of KEYS_OF_ROLE) {
    for (const key of keys) roleColors[key] = colors[role];
  }
  return {
    ...base,
    ...roleColors,
    regular: 'Noto Sans Regular',
    bold: 'Noto Sans Regular',
    italic: 'Noto Sans Regular',
    landcover: { barren: colors.land, farmland: colors.green, forest: colors.green, glacier: colors.land, grassland: colors.green, scrub: colors.green, urban_area: colors.building },
    pois: { blue: colors.label, green: colors.label, lapis: colors.label, pink: colors.label, red: colors.label, slategray: colors.label, tangerine: colors.label, turquoise: colors.label },
  };
}

/**
 * The style of the map for a theme and a language. Labels show the name of the screen language (Arabic names first in Arabic).
 * The source and the glyphs read the own address of this page, so the map never asks a third party at run time.
 */
export function madarMapStyle(theme: MapTheme, lang: Lang): StyleSpecification {
  const origin = window.location.origin;
  const kept = layers('protomaps', flavorOf(theme), { lang }).filter((layer) => !('source-layer' in layer && layer['source-layer'] === 'pois'));
  return {
    version: 8,
    name: 'Madar',
    glyphs: `${origin}${MAP_PATHS.glyphs}`,
    sources: { protomaps: { type: 'vector', url: `pmtiles://${origin}${MAP_PATHS.file}` } },
    layers: kept,
  };
}
