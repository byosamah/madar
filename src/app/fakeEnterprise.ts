import { VADO_ENTERPRISE } from '../api/vadoEnterprise';

/**
 * Which fake enterprise the prototype shows, and whether it shows the platform owner view (Madar enterprises, design 5.19). Both choices
 * live in localStorage, so a reload keeps them. Every read is inside try/catch: a blocked store gives the defaults.
 */
const ENTERPRISE_KEY = 'madar.fakeEnterprise';
const PLATFORM_KEY = 'madar.fakePlatform';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // A blocked store keeps the default. The page still works.
  }
}

/**
 * The id of the fake enterprise to open. `known` is the list of ids of the fake directory: an id that is not in it gives the default,
 * VADOs' Companies. Without `known` the stored id stands.
 */
export function activeFakeEnterprise(known?: readonly string[]): string {
  const stored = read(ENTERPRISE_KEY);
  if (!stored || (known && !known.includes(stored))) return VADO_ENTERPRISE;
  return stored;
}

/** Stores the choice, turns the owner view off (it belongs to VADOs' Companies) and reloads the page, so the other store opens. */
export function chooseFakeEnterprise(id: string): void {
  write(ENTERPRISE_KEY, id === VADO_ENTERPRISE ? null : id);
  write(PLATFORM_KEY, null);
  window.location.reload();
}

export function platformOwnerMode(): boolean {
  return read(PLATFORM_KEY) === '1';
}

export function setPlatformOwnerMode(on: boolean): void {
  write(PLATFORM_KEY, on ? '1' : null);
}
