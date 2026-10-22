import {
  BASIC_ON, CATALOG_SECTIONS, DEFAULT_EXTRA, RIGHT_NEEDS, withNeeds, type CatalogRightId, type RightScope,
} from '../../../api/rightsCatalog';

/**
 * The plain logic of the role sheet (role rights version 2, 2026-10-21): the 13 sections with their powers and switches, how a switch
 * moves with the switches it needs, the All switch of a section, the standard list, and the two shapes that a role is saved in. The
 * screens read it; it holds no word and no React.
 */

export type SheetSwitch = { readonly id: CatalogRightId; readonly scope: RightScope | null };
export type SheetPower = { readonly power: string; readonly key: string; readonly switches: readonly SheetSwitch[] };
export type SheetSection = { readonly key: string; readonly powers: readonly SheetPower[]; readonly ids: readonly CatalogRightId[] };

/** The word key of a power: its dotted name in camel case. `project.create` is `projectCreate`, at `roleRights.powers.projectCreate`. */
export function powerKey(power: string): string {
  const [first, ...rest] = power.split('.');
  return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/** The sections of the sheet, from the catalog: the same order as the catalog, 13 sections, 85 powers, 113 switches. */
export const SHEET_SECTIONS: readonly SheetSection[] = CATALOG_SECTIONS.map((section) => {
  const powers = section.powers.map((power) => ({
    power: power.power, key: powerKey(power.power), switches: power.switches.map((item) => ({ id: item.id, scope: item.scope })),
  }));
  return { key: section.key, powers, ids: powers.flatMap((power) => power.switches.map((item) => item.id)) };
});

/** The switch ids that need the given switch, directly. */
function dependantsOf(id: CatalogRightId): CatalogRightId[] {
  return (Object.keys(RIGHT_NEEDS) as CatalogRightId[]).filter((other) => RIGHT_NEEDS[other].includes(id));
}

/** The switches with the given ones removed, and every switch that needs one of them, again and again. */
function withoutAll(held: readonly CatalogRightId[], gone: readonly CatalogRightId[]): CatalogRightId[] {
  const out = new Set<CatalogRightId>(gone);
  for (let again = true; again; ) {
    again = false;
    for (const id of [...out]) for (const next of dependantsOf(id)) if (!out.has(next)) { out.add(next); again = true; }
  }
  return held.filter((id) => !out.has(id));
}

/** The switches with one of them on or off. On brings the switches it needs. Off takes away the switches that need it. */
export function withRight(held: readonly CatalogRightId[], id: CatalogRightId, on: boolean): CatalogRightId[] {
  return on ? withNeeds([...held, id]) : withoutAll(held, [id]);
}

/** The switches with every switch of one section on or off. The switches of the other sections stay, except those that need a switch that went off. */
export function withSection(held: readonly CatalogRightId[], ids: readonly CatalogRightId[], on: boolean): CatalogRightId[] {
  return on ? withNeeds([...held, ...ids]) : withoutAll(held, ids);
}

export type SectionState = 'on' | 'off' | 'mixed';

/** The state of the All switch of a section: on when every switch is on, off when none is on, mixed between. */
export function sectionState(held: readonly CatalogRightId[], ids: readonly CatalogRightId[]): SectionState {
  const on = ids.filter((id) => held.includes(id)).length;
  return on === 0 ? 'off' : on === ids.length ? 'on' : 'mixed';
}

/** The standard list of a built-in role: the 64 basic switches plus the extras that the role holds by default. */
export function standardListOf(role: 'management' | 'accounting' | 'member'): CatalogRightId[] {
  return withNeeds([...BASIC_ON, ...DEFAULT_EXTRA[role]]);
}

/**
 * The two lists that a role is saved with. `rights` holds the switches that are not basic. `off` holds the basic switches that the
 * role does not hold. The server keeps both (roles.create, roles.update).
 */
export function saveShape(held: readonly CatalogRightId[]): { rights: CatalogRightId[]; off: CatalogRightId[] } {
  return { rights: held.filter((id) => !BASIC_ON.includes(id)), off: BASIC_ON.filter((id) => !held.includes(id)) };
}

/** The "Projects I lead" switches of the Projects section that are off. */
export function leadSwitchesOff(held: readonly CatalogRightId[]): number {
  const projects = SHEET_SECTIONS.find((section) => section.key === 'projects');
  return (projects?.powers ?? []).flatMap((power) => power.switches).filter((item) => item.scope === 'lead' && !held.includes(item.id)).length;
}

/** True when a person who makes a project could not use it: Create projects is on, and three or more "Projects I lead" switches are off. */
export function holdsLeaderWarning(held: readonly CatalogRightId[]): boolean {
  return held.includes('project.create') && leadSwitchesOff(held) >= 3;
}

/** The count of switches above and below the standard list (the 64 basic switches), for the line of a role in the person sheet. */
export function roleLineParts(held: readonly CatalogRightId[]): { more: number; less: number } {
  return { more: held.filter((id) => !BASIC_ON.includes(id)).length, less: BASIC_ON.filter((id) => !held.includes(id)).length };
}

/** The switches that the power needs and that belong to other powers, in catalog order. A need inside the power shows by itself. */
export function outsideNeeds(power: SheetPower): CatalogRightId[] {
  const own = new Set(power.switches.map((item) => item.id));
  const out = new Set<CatalogRightId>();
  for (const item of power.switches) for (const need of RIGHT_NEEDS[item.id]) if (!own.has(need)) out.add(need);
  return [...out];
}
